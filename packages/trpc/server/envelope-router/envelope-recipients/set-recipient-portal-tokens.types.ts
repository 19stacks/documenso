import { z } from 'zod';

import type { TrpcRouteMeta } from '../../trpc';

export const setRecipientPortalTokensMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/envelope/recipient/portal-token',
    summary: 'Set recipient portal tokens',
    description: 'Store a portal link token on recipients of an envelope',
    tags: ['Envelope Recipients'],
  },
};

export const ZRecipientPortalTokenSchema = z.object({
  recipientId: z.number().int().positive(),
  portalToken: z.string().trim().min(1).max(64),
});

export const ZSetRecipientPortalTokensRequestSchema = z.object({
  envelopeId: z.string().min(1),
  data: ZRecipientPortalTokenSchema.array().min(1),
});

export const ZSetRecipientPortalTokensResponseSchema = z.object({
  success: z.boolean(),
  updated: z.number().int(),
});

export type TSetRecipientPortalTokensRequest = z.infer<typeof ZSetRecipientPortalTokensRequestSchema>;
export type TSetRecipientPortalTokensResponse = z.infer<typeof ZSetRecipientPortalTokensResponseSchema>;
