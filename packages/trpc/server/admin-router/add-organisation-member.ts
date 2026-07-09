import { addOrganisationMember } from '@documenso/lib/server-only/organisation/add-organisation-member';

import { adminProcedure } from '../trpc';
import {
  ZAddOrganisationMemberRequestSchema,
  ZAddOrganisationMemberResponseSchema,
} from './add-organisation-member.types';

export const addOrganisationMemberRoute = adminProcedure
  .input(ZAddOrganisationMemberRequestSchema)
  .output(ZAddOrganisationMemberResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { organisationId, userId, organisationRole } = input;

    ctx.logger.info({ input: { organisationId, userId } });

    return await addOrganisationMember({
      organisationId,
      userId,
      organisationRole,
    });
  });
