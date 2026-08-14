import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import type { ApiRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { prisma } from '@documenso/prisma';
import {
  DocumentSigningOrder,
  DocumentStatus,
  EnvelopeType,
  RecipientRole,
  SendStatus,
  SigningStatus,
} from '@prisma/client';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { jobs } from '../../jobs/client';
import { extractDerivedDocumentEmailSettings } from '../../types/document-email';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import { mapSecondaryIdToDocumentId } from '../../utils/envelope';
import {
  canRecipientBeModified,
  getRecipientsWithMissingFields,
  isRecipientEmailValidForSending,
} from '../../utils/recipients';
import { assertEnvelopeMutable } from '../envelope/assert-envelope-mutable';
import { getEnvelopeWhereInput } from '../envelope/get-envelope-by-id';

export type DeleteEnvelopeRecipientOptions = {
  userId: number;
  teamId: number;
  recipientId: number;
  requestMetadata: ApiRequestMetadata;
};

export const deleteEnvelopeRecipient = async ({
  userId,
  teamId,
  recipientId,
  requestMetadata,
}: DeleteEnvelopeRecipientOptions) => {
  const envelope = await prisma.envelope.findFirst({
    where: {
      recipients: {
        some: {
          id: recipientId,
        },
      },
      teamId,
    },
    include: {
      documentMeta: true,
      team: true,
      recipients: {
        where: {
          id: recipientId,
        },
        include: {
          fields: true,
        },
      },
    },
  });

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  if (!envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Document not found',
    });
  }

  assertEnvelopeMutable(envelope);

  if (envelope.completedAt) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Document already complete',
    });
  }

  if (!user) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'User not found',
    });
  }

  const recipientToDelete = envelope.recipients[0];

  if (!recipientToDelete || recipientToDelete.id !== recipientId) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Recipient not found',
    });
  }

  if (!canRecipientBeModified(recipientToDelete, recipientToDelete.fields)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Recipient has already interacted with the document.',
    });
  }

  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: {
      type: 'envelopeId',
      id: envelope.id,
    },
    type: null,
    userId,
    teamId,
  });

  const deletedRecipient = await prisma.$transaction(async (tx) => {
    await assertEnvelopeMutable(envelope, tx);

    if (envelope.type === EnvelopeType.DOCUMENT) {
      await tx.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.RECIPIENT_DELETED,
          envelopeId: envelope.id,
          metadata: requestMetadata,
          data: {
            recipientEmail: recipientToDelete.email,
            recipientName: recipientToDelete.name,
            recipientId: recipientToDelete.id,
            recipientRole: recipientToDelete.role,
          },
        }),
      });
    }

    return await tx.recipient.delete({
      where: {
        id: recipientId,
        envelope: envelopeWhereInput,
      },
    });
  });

  const isRecipientRemovedEmailEnabled = extractDerivedDocumentEmailSettings(envelope.documentMeta).recipientRemoved;

  // Send email to deleted recipient.
  if (
    recipientToDelete.sendStatus === SendStatus.SENT &&
    recipientToDelete.role !== RecipientRole.CC &&
    isRecipientRemovedEmailEnabled &&
    envelope.type === EnvelopeType.DOCUMENT &&
    isRecipientEmailValidForSending(recipientToDelete)
  ) {
    // Enqueue the "removed from document" email as a background job so a
    // transient mail outage doesn't fail the request and the send is retried.
    await jobs.triggerJob({
      name: 'send.recipient.removed.email',
      payload: {
        envelopeId: envelope.id,
        recipientEmail: recipientToDelete.email,
        recipientName: recipientToDelete.name,
        inviterName: envelope.team?.name || user.name || undefined,
      },
    });
  }

  // If this was a sequential document and the deleted recipient was next (or ahead),
  // notify the new next pending recipient whose turn it now is.
  if (
    envelope.type === EnvelopeType.DOCUMENT &&
    envelope.status === DocumentStatus.PENDING &&
    envelope.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL
  ) {
    const remainingRecipients = await prisma.recipient.findMany({
      where: {
        envelopeId: envelope.id,
        role: {
          not: RecipientRole.CC,
        },
      },
      orderBy: [{ signingOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });

    const nextRecipient = remainingRecipients.find((recipient) => recipient.signingStatus !== SigningStatus.SIGNED);

    const isNextRecipientsTurn =
      Boolean(nextRecipient) &&
      remainingRecipients
        .filter((recipient) => {
          if (!nextRecipient || recipient.id === nextRecipient.id) {
            return false;
          }

          const nextOrder = nextRecipient.signingOrder ?? Number.MAX_SAFE_INTEGER;
          const recipientOrder = recipient.signingOrder ?? Number.MAX_SAFE_INTEGER;

          return recipientOrder < nextOrder;
        })
        .every((recipient) => recipient.signingStatus === SigningStatus.SIGNED);

    // Don't notify the next signer until they have their required signature fields,
    // so the recipient is not emailed before they are able to sign.
    let isNextRecipientReadyToSign = false;

    if (nextRecipient) {
      const fields = await prisma.field.findMany({
        where: {
          envelopeId: envelope.id,
        },
        select: {
          type: true,
          recipientId: true,
        },
      });

      isNextRecipientReadyToSign = getRecipientsWithMissingFields([nextRecipient], fields).length === 0;
    }

    if (
      nextRecipient &&
      isNextRecipientsTurn &&
      nextRecipient.sendStatus !== SendStatus.SENT &&
      isNextRecipientReadyToSign
    ) {
      await prisma.recipient.update({
        where: { id: nextRecipient.id },
        data: {
          sendStatus: SendStatus.SENT,
          sentAt: new Date(),
        },
      });

      await jobs.triggerJob({
        name: 'send.signing.requested.email',
        payload: {
          userId: envelope.userId,
          documentId: mapSecondaryIdToDocumentId(envelope.secondaryId),
          recipientId: nextRecipient.id,
          requestMetadata: requestMetadata.requestMetadata,
        },
      });
    }
  }

  return deletedRecipient;
};
