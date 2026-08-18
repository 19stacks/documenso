import { prisma } from '@documenso/prisma';
import { FieldType, RecipientRole } from '@prisma/client';

const SIGNATURE_FIELD_TYPES = [FieldType.SIGNATURE, FieldType.FREE_SIGNATURE] as const;

/**
 * Whether a recipient is ready to be notified/advanced for signing.
 *
 * Only SIGNER recipients require a signature field; all other roles are
 * considered ready immediately.
 *
 * Scoped to the single recipient so it can be answered with an indexed
 * `COUNT` rather than fetching every field on the envelope.
 */
export const isRecipientReadyToSign = async (
  recipient: { id: number; role: RecipientRole },
  envelopeId: string,
): Promise<boolean> => {
  if (recipient.role !== RecipientRole.SIGNER) {
    return true;
  }

  const count = await prisma.field.count({
    where: {
      envelopeId,
      recipientId: recipient.id,
      type: { in: [...SIGNATURE_FIELD_TYPES] },
    },
  });

  return count > 0;
};
