import { DEFAULT_DOCUMENT_DATE_FORMAT } from '@documenso/lib/constants/date-formats';
import { DEFAULT_DOCUMENT_TIME_ZONE } from '@documenso/lib/constants/time-zones';
import { DOCUMENT_AUDIT_LOG_TYPE, RECIPIENT_DIFF_TYPE } from '@documenso/lib/types/document-audit-logs';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { fieldsContainUnsignedRequiredField } from '@documenso/lib/utils/advanced-fields-helpers';
import { createDocumentAuditLogData } from '@documenso/lib/utils/document-audit-logs';
import { prisma } from '@documenso/prisma';
import {
  DocumentSigningOrder,
  DocumentStatus,
  EnvelopeType,
  FieldType,
  RecipientRole,
  SendStatus,
  SigningStatus,
  WebhookTriggerEvents,
} from '@prisma/client';
import { DateTime } from 'luxon';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { jobs } from '../../jobs/client';
import type { TRecipientAccessAuth } from '../../types/document-auth';
import { DocumentAuth } from '../../types/document-auth';
import { mapEnvelopeToWebhookDocumentPayload, ZWebhookDocumentSchema } from '../../types/webhook-payload';
import { extractDocumentAuthMethods } from '../../utils/document-auth';
import type { EnvelopeIdOptions } from '../../utils/envelope';
import { mapSecondaryIdToDocumentId, unsafeBuildEnvelopeIdQuery } from '../../utils/envelope';
import { logger } from '../../utils/logger';
import { assertRecipientNotExpired } from '../../utils/recipients';
import { getIsRecipientsTurnToSign } from '../recipient/get-is-recipient-turn';
import { isRecipientReadyToSign } from '../recipient/is-recipient-ready-to-sign';
import { triggerWebhook } from '../webhooks/trigger/trigger-webhook';
import { isRecipientAuthorized } from './is-recipient-authorized';

export type CompleteDocumentWithTokenOptions = {
  token: string;
  id: EnvelopeIdOptions;
  userId?: number;
  accessAuthOptions?: TRecipientAccessAuth;
  requestMetadata?: RequestMetadata;
  nextSigner?: {
    email: string;
    name: string;
  };
  /**
   * Override the recipient information. This will only work if the recipient
   * does not have a name or email set.
   */
  recipientOverride?: {
    email?: string;
    name?: string;
  };
};

export type CompleteDocumentWithTokenResult = {
  dictatedNextSignerUnavailable?: {
    email: string;
    name: string;
  };
  notifiedNextRecipient?: {
    id: number;
    email: string;
    name: string;
  };
  nextRecipientNotReady?: {
    id: number;
    email: string;
    name: string;
  };
};

export const completeDocumentWithToken = async ({
  token,
  id,
  userId,
  accessAuthOptions,
  requestMetadata,
  nextSigner,
  recipientOverride,
}: CompleteDocumentWithTokenOptions): Promise<CompleteDocumentWithTokenResult> => {
  const envelope = await prisma.envelope.findFirstOrThrow({
    where: {
      ...unsafeBuildEnvelopeIdQuery(id, EnvelopeType.DOCUMENT),
      recipients: {
        some: {
          token,
        },
      },
    },
    include: {
      documentMeta: true,
      recipients: {
        where: {
          token,
        },
      },
    },
  });

  const legacyDocumentId = mapSecondaryIdToDocumentId(envelope.secondaryId);

  if (envelope.status !== DocumentStatus.PENDING) {
    throw new Error(`Document ${envelope.id} must be pending`);
  }

  if (envelope.recipients.length === 0) {
    throw new Error(`Document ${envelope.id} has no recipient with token ${token}`);
  }

  const [recipient] = envelope.recipients;

  assertRecipientNotExpired(recipient);

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    throw new Error(`Recipient ${recipient.id} has already signed`);
  }

  if (recipient.signingStatus === SigningStatus.REJECTED) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'Recipient has already rejected the document',
      statusCode: 400,
    });
  }

  if (envelope.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL) {
    const isRecipientsTurn = await getIsRecipientsTurnToSign({
      token: recipient.token,
    });

    if (!isRecipientsTurn) {
      throw new Error(`Recipient ${recipient.id} attempted to complete the document before it was their turn`);
    }
  }

  // Check ACCESS AUTH 2FA validation during document completion
  const { derivedRecipientAccessAuth } = extractDocumentAuthMethods({
    documentAuth: envelope.authOptions,
    recipientAuth: recipient.authOptions,
  });

  if (derivedRecipientAccessAuth.includes(DocumentAuth.TWO_FACTOR_AUTH)) {
    if (!accessAuthOptions) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, {
        message: 'Access authentication required',
      });
    }

    if (!recipient.email.trim()) {
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: `Recipient ${recipient.id} requires an email because they have auth requirements.`,
      });
    }

    const isValid = await isRecipientAuthorized({
      type: 'ACCESS_2FA',
      documentAuthOptions: envelope.authOptions,
      recipient: recipient,
      userId, // Can be undefined for non-account recipients
      authOptions: accessAuthOptions,
    });

    if (!isValid) {
      await prisma.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_ACCESS_AUTH_2FA_FAILED,
          envelopeId: envelope.id,
          data: {
            recipientId: recipient.id,
            recipientName: recipient.name,
            recipientEmail: recipient.email,
          },
        }),
      });

      throw new AppError(AppErrorCode.TWO_FACTOR_AUTH_FAILED, {
        message: 'Invalid 2FA authentication',
      });
    }

    await prisma.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_ACCESS_AUTH_2FA_VALIDATED,
        envelopeId: envelope.id,
        data: {
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientEmail: recipient.email,
        },
      }),
    });
  }

  let fields = await prisma.field.findMany({
    where: {
      envelopeId: envelope.id,
      recipientId: recipient.id,
    },
  });

  // This should be scoped to the current recipient.
  const uninsertedDateFields = fields.filter((field) => field.type === FieldType.DATE && !field.inserted);

  let recipientName = recipient.name;
  let recipientEmail = recipient.email;

  // Only trim the name if it's been derived.
  if (!recipientName) {
    recipientName = (
      recipientOverride?.name ||
      fields.find((field) => field.type === FieldType.NAME)?.customText ||
      ''
    ).trim();
  }

  // Only trim the email if it's been derived.
  if (!recipient.email) {
    recipientEmail = (
      recipientOverride?.email ||
      fields.find((field) => field.type === FieldType.EMAIL)?.customText ||
      ''
    )
      .trim()
      .toLowerCase();
  }

  if (!recipientEmail) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'Recipient email is required',
    });
  }

  // Auto-insert all un-inserted date fields for V2 envelopes at completion time.
  if (envelope.internalVersion === 2 && uninsertedDateFields.length > 0) {
    const formattedDate = DateTime.now()
      .setZone(envelope.documentMeta?.timezone ?? DEFAULT_DOCUMENT_TIME_ZONE)
      .toFormat(envelope.documentMeta?.dateFormat ?? DEFAULT_DOCUMENT_DATE_FORMAT);

    const newDateFieldValues = {
      customText: formattedDate,
      inserted: true,
    };

    await prisma.field.updateMany({
      where: {
        id: {
          in: uninsertedDateFields.map((field) => field.id),
        },
      },
      data: {
        ...newDateFieldValues,
      },
    });

    // Create audit log entries for each auto-inserted date field.
    await prisma.documentAuditLog.createMany({
      data: uninsertedDateFields.map((field) =>
        createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_FIELD_INSERTED,
          envelopeId: envelope.id,
          user: {
            email: recipientEmail,
            name: recipientName,
          },
          requestMetadata,
          data: {
            recipientEmail: recipientEmail,
            recipientId: recipient.id,
            recipientName: recipientName,
            recipientRole: recipient.role,
            fieldId: field.secondaryId,
            field: {
              type: FieldType.DATE,
              data: formattedDate,
            },
          },
        }),
      ),
    });

    // Update the local fields array so the subsequent validation check passes.
    fields = fields.map((field) => {
      if (field.type === FieldType.DATE && !field.inserted) {
        return {
          ...field,
          ...newDateFieldValues,
        };
      }

      return field;
    });
  }

  if (fieldsContainUnsignedRequiredField(fields)) {
    throw new Error(`Recipient ${recipient.id} has unsigned fields`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.recipient.update({
      where: {
        id: recipient.id,
      },
      data: {
        signingStatus: SigningStatus.SIGNED,
        signedAt: new Date(),
        name: recipientName,
        email: recipientEmail,
      },
    });

    if (recipientEmail !== recipient.email || recipientName !== recipient.name) {
      await tx.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.RECIPIENT_UPDATED,
          envelopeId: envelope.id,
          user: {
            name: recipientName,
            email: recipientEmail,
          },
          requestMetadata,
          data: {
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            recipientId: recipient.id,
            recipientRole: recipient.role,
            changes: [
              {
                type: RECIPIENT_DIFF_TYPE.NAME,
                from: recipient.name,
                to: recipientName,
              },
              {
                type: RECIPIENT_DIFF_TYPE.EMAIL,
                from: recipient.email,
                to: recipientEmail,
              },
            ],
          },
        }),
      });
    }

    const authOptions = extractDocumentAuthMethods({
      documentAuth: envelope.authOptions,
      recipientAuth: recipient.authOptions,
    });

    await tx.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED,
        envelopeId: envelope.id,
        user: {
          name: recipientName,
          email: recipientEmail,
        },
        requestMetadata,
        data: {
          recipientEmail: recipientEmail,
          recipientName: recipientName,
          recipientId: recipient.id,
          recipientRole: recipient.role,
          actionAuth: authOptions.derivedRecipientActionAuth,
        },
      }),
    });
  });

  const envelopeWithRelations = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelope.id },
    include: { documentMeta: true, recipients: true },
  });

  await triggerWebhook({
    event: WebhookTriggerEvents.DOCUMENT_RECIPIENT_COMPLETED,
    data: ZWebhookDocumentSchema.parse(mapEnvelopeToWebhookDocumentPayload(envelopeWithRelations)),
    userId: envelope.userId,
    teamId: envelope.teamId,
  });

  await jobs.triggerJob({
    name: 'send.recipient.signed.email',
    payload: {
      documentId: legacyDocumentId,
      recipientId: recipient.id,
    },
  });

  const pendingRecipients = await prisma.recipient.findMany({
    select: {
      id: true,
      signingOrder: true,
      name: true,
      email: true,
      role: true,
    },
    where: {
      envelopeId: envelope.id,
      signingStatus: {
        not: SigningStatus.SIGNED,
      },
      role: {
        not: RecipientRole.CC,
      },
    },
    // Composite sort so our next recipient is always the one with the lowest signing order or id
    // if there is a tie.
    orderBy: [{ signingOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  });

  let dictatedNextSignerUnavailable: CompleteDocumentWithTokenResult['dictatedNextSignerUnavailable'];
  let notifiedNextRecipient: CompleteDocumentWithTokenResult['notifiedNextRecipient'];
  let nextRecipientNotReady: CompleteDocumentWithTokenResult['nextRecipientNotReady'];

  if (pendingRecipients.length > 0) {
    await jobs.triggerJob({
      name: 'send.document.pending.email',
      payload: {
        envelopeId: envelope.id,
        recipientId: recipient.id,
      },
    });

    if (envelope.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL) {
      const [immediateNextRecipient] = pendingRecipients;

      let nextRecipientToNotify = immediateNextRecipient;

      // Resolve any dictated next signer before deciding whether to notify, so we can
      // skip the email when the recipient still has no signature fields.
      let selectedRecipient: (typeof pendingRecipients)[number] | undefined;

      if (nextSigner && envelope.documentMeta?.allowDictateNextSigner) {
        selectedRecipient = pendingRecipients.find(
          (pendingRecipient) => pendingRecipient.email.toLowerCase() === nextSigner.email.toLowerCase(),
        );

        if (!selectedRecipient) {
          dictatedNextSignerUnavailable = {
            email: nextSigner.email,
            name: nextSigner.name,
          };
        }

        if (selectedRecipient) {
          nextRecipientToNotify = selectedRecipient;
        }
      }

      const isNextRecipientReadyToSign = await isRecipientReadyToSign(nextRecipientToNotify, envelope.id);

      if (isNextRecipientReadyToSign) {
        await prisma.$transaction(async (tx) => {
          // Promote the selected pending recipient to sign next by swapping signing order.
          // If the dictated signer is no longer pending (e.g. deleted), fall back to the
          // immediate next recipient so signing completion still notifies someone.
          if (selectedRecipient && selectedRecipient.id !== immediateNextRecipient.id) {
            const selectedSigningOrder = selectedRecipient.signingOrder;
            const immediateNextSigningOrder = immediateNextRecipient.signingOrder;

            if (selectedSigningOrder !== null && immediateNextSigningOrder !== null) {
              await tx.recipient.update({
                where: { id: selectedRecipient.id },
                data: {
                  signingOrder: immediateNextSigningOrder,
                  sendStatus: SendStatus.SENT,
                  sentAt: new Date(),
                },
              });

              await tx.recipient.update({
                where: { id: immediateNextRecipient.id },
                data: {
                  signingOrder: selectedSigningOrder,
                },
              });

              await tx.documentAuditLog.create({
                data: createDocumentAuditLogData({
                  type: DOCUMENT_AUDIT_LOG_TYPE.RECIPIENT_UPDATED,
                  envelopeId: envelope.id,
                  user: {
                    name: recipientName,
                    email: recipientEmail,
                  },
                  requestMetadata,
                  data: {
                    recipientEmail: selectedRecipient.email,
                    recipientName: selectedRecipient.name,
                    recipientId: selectedRecipient.id,
                    recipientRole: selectedRecipient.role,
                    changes: [
                      {
                        type: RECIPIENT_DIFF_TYPE.SIGNING_ORDER,
                        from: selectedSigningOrder,
                        to: immediateNextSigningOrder,
                      },
                    ],
                  },
                }),
              });
            } else {
              // Fallback if null, just send to the selected recipient without swapping
              await tx.recipient.update({
                where: { id: selectedRecipient.id },
                data: {
                  sendStatus: SendStatus.SENT,
                  sentAt: new Date(),
                },
              });
            }
          } else {
            await tx.recipient.update({
              where: { id: immediateNextRecipient.id },
              data: {
                sendStatus: SendStatus.SENT,
                sentAt: new Date(),
              },
            });

            // Audit the fallback when the dictated signer is no longer a pending
            // recipient, so the audit trail shows why the immediate next recipient
            // was notified instead of the dictated signer.
            if (dictatedNextSignerUnavailable) {
              await tx.documentAuditLog.create({
                data: createDocumentAuditLogData({
                  type: DOCUMENT_AUDIT_LOG_TYPE.RECIPIENT_UPDATED,
                  envelopeId: envelope.id,
                  user: {
                    name: recipientName,
                    email: recipientEmail,
                  },
                  requestMetadata,
                  data: {
                    recipientEmail: immediateNextRecipient.email,
                    recipientName: immediateNextRecipient.name,
                    recipientId: immediateNextRecipient.id,
                    recipientRole: immediateNextRecipient.role,
                    changes: [
                      {
                        type: RECIPIENT_DIFF_TYPE.DICTATED_SIGNER_UNAVAILABLE,
                        dictatedSignerEmail: dictatedNextSignerUnavailable.email,
                        dictatedSignerName: dictatedNextSignerUnavailable.name,
                      },
                    ],
                  },
                }),
              });
            }
          }
        });

        notifiedNextRecipient = {
          id: nextRecipientToNotify.id,
          email: nextRecipientToNotify.email,
          name: nextRecipientToNotify.name,
        };

        await jobs.triggerJob({
          name: 'send.signing.requested.email',
          payload: {
            userId: envelope.userId,
            documentId: legacyDocumentId,
            recipientId: nextRecipientToNotify.id,
            requestMetadata,
          },
        });
      } else {
        nextRecipientNotReady = {
          id: nextRecipientToNotify.id,
          email: nextRecipientToNotify.email,
          name: nextRecipientToNotify.name,
        };

        logger.warn({
          msg: 'Skipped notifying next signer: recipient has no signature fields to sign',
          envelopeId: envelope.id,
          recipientId: nextRecipientToNotify.id,
          recipientEmail: nextRecipientToNotify.email,
        });
      }
    }
  }

  const haveAllRecipientsSigned = await prisma.envelope.findFirst({
    where: {
      id: envelope.id,
      recipients: {
        every: {
          OR: [{ signingStatus: SigningStatus.SIGNED }, { role: RecipientRole.CC }],
        },
      },
    },
  });

  if (haveAllRecipientsSigned) {
    await jobs.triggerJob({
      name: 'internal.seal-document',
      payload: {
        documentId: legacyDocumentId,
        requestMetadata,
      },
    });
  }

  const updatedDocument = await prisma.envelope.findFirstOrThrow({
    where: {
      id: envelope.id,
      type: EnvelopeType.DOCUMENT,
    },
    include: {
      documentMeta: true,
      recipients: true,
    },
  });

  await triggerWebhook({
    event: WebhookTriggerEvents.DOCUMENT_SIGNED,
    data: ZWebhookDocumentSchema.parse(mapEnvelopeToWebhookDocumentPayload(updatedDocument)),
    userId: updatedDocument.userId,
    teamId: updatedDocument.teamId ?? undefined,
  });

  return {
    dictatedNextSignerUnavailable,
    notifiedNextRecipient,
    nextRecipientNotReady,
  };
};
