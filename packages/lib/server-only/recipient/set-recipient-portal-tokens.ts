import { prisma } from '@documenso/prisma';
import { Prisma } from '@prisma/client';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { getEnvelopeWhereInput } from '../envelope/get-envelope-by-id';

export type SetRecipientPortalTokensOptions = {
  userId: number;
  teamId: number;
  envelopeId: string;
  tokens: Array<{
    recipientId: number;
    portalToken: string;
  }>;
};

/**
 * Stores Wize's permanent portal link token on recipients, so the page a
 * recipient lands on after signing can link back to their portal.
 *
 * The envelope is resolved through `getEnvelopeWhereInput` first, which keeps
 * the write inside the caller's team boundary. The whole batch is then written
 * in one statement — never a round trip per recipient — and is idempotent, so
 * re-adding a signer or replaying a webhook simply overwrites the same value.
 */
export const setRecipientPortalTokens = async ({
  userId,
  teamId,
  envelopeId,
  tokens,
}: SetRecipientPortalTokensOptions) => {
  const uniqueTokens = new Map<number, string>();
  for (const { recipientId, portalToken } of tokens) {
    uniqueTokens.set(recipientId, portalToken);
  }

  if (uniqueTokens.size === 0) {
    return { updated: 0 };
  }

  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: {
      type: 'envelopeId',
      id: envelopeId,
    },
    type: null,
    userId,
    teamId,
  });

  const envelope = await prisma.envelope.findFirst({
    where: envelopeWhereInput,
    select: {
      id: true,
    },
  });

  if (!envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Envelope not found',
    });
  }

  const values = Prisma.join(
    [...uniqueTokens.entries()].map(
      ([recipientId, portalToken]) => Prisma.sql`(${recipientId}::int, ${portalToken}::varchar)`,
    ),
    ', ',
  );

  const updatedRecipients = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    UPDATE "Recipient" AS r
       SET "portalToken" = v."portalToken"
      FROM (VALUES ${values}) AS v("id", "portalToken")
     WHERE r."id" = v."id"
       AND r."envelopeId" = ${envelope.id}
    RETURNING r."id"
  `);

  return { updated: updatedRecipients.length };
};
