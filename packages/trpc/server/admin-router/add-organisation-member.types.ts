import { OrganisationMemberRole } from '@prisma/client';
import { z } from 'zod';
export const ZAddOrganisationMemberRequestSchema = z.object({
  organisationId: z.string().min(1),
  userId: z.number().min(1),
  organisationRole: z.nativeEnum(OrganisationMemberRole).optional(),
});
export const ZAddOrganisationMemberResponseSchema = z.object({
  organisationMemberId: z.string(),
  userId: z.number(),
  organisationId: z.string(),
  alreadyMember: z.boolean(),
});
