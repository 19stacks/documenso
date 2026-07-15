import { AppError, genericErrorCodeToTrpcErrorCodeMap } from '@documenso/lib/errors/app-error';
import { resendDocument } from '@documenso/lib/server-only/document/resend-document';
import { formatSigningLink } from '@documenso/lib/utils/recipients';
import { TRPCError } from '@trpc/server';

import { authenticatedProcedure } from '../trpc';
import {
  redistributeEnvelopeMeta,
  ZRedistributeEnvelopeRequestSchema,
  ZRedistributeEnvelopeResponseSchema,
} from './redistribute-envelope.types';

export const redistributeEnvelopeRoute = authenticatedProcedure
  .meta(redistributeEnvelopeMeta)
  .input(ZRedistributeEnvelopeRequestSchema)
  .output(ZRedistributeEnvelopeResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { envelopeId, recipients } = input;

    try {
      ctx.logger.info({
        input: {
          envelopeId,
          recipients,
        },
      });

      const envelope = await resendDocument({
        userId: ctx.user.id,
        teamId,
        id: {
          type: 'envelopeId',
          id: envelopeId,
        },
        recipients,
        requestMetadata: ctx.metadata,
      });

      return {
        success: true,
        id: envelope.id,
        recipients: envelope.recipients.map((recipient) => ({
          id: recipient.id,
          name: recipient.name,
          email: recipient.email,
          token: recipient.token,
          role: recipient.role,
          signingOrder: recipient.signingOrder,
          signingUrl: formatSigningLink(recipient.token),
        })),
      };
    } catch (err) {
      const error = AppError.parseError(err);

      const mapped = genericErrorCodeToTrpcErrorCodeMap[error.code] ?? {
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
      };

      throw new TRPCError({
        code: mapped.code as TRPCError['code'],
        message: error.message,
        cause: err,
      });
    }
  });
