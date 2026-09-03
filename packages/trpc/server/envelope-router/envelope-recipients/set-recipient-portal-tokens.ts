import { setRecipientPortalTokens } from '@documenso/lib/server-only/recipient/set-recipient-portal-tokens';

import { authenticatedProcedure } from '../../trpc';
import {
  setRecipientPortalTokensMeta,
  ZSetRecipientPortalTokensRequestSchema,
  ZSetRecipientPortalTokensResponseSchema,
} from './set-recipient-portal-tokens.types';

export const setRecipientPortalTokensRoute = authenticatedProcedure
  .meta(setRecipientPortalTokensMeta)
  .input(ZSetRecipientPortalTokensRequestSchema)
  .output(ZSetRecipientPortalTokensResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { user, teamId } = ctx;
    const { envelopeId, data: tokens } = input;

    ctx.logger.info({
      input: {
        envelopeId,
        recipients: tokens.length,
      },
    });

    const { updated } = await setRecipientPortalTokens({
      userId: user.id,
      teamId,
      envelopeId,
      tokens,
    });

    if (updated !== tokens.length) {
      ctx.logger.warn({
        message: 'Portal token sync updated fewer recipients than requested',
        input: {
          envelopeId,
          requested: tokens.length,
          updated,
        },
      });
    }

    return {
      success: true,
      updated,
    };
  });
