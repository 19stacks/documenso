import { prisma } from '@documenso/prisma';
import { OrganisationGroupType, OrganisationMemberRole } from '@prisma/client';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { addUserToOrganisation } from './accept-organisation-invitation';

type AddOrganisationMemberOptions = {
  organisationId: string;
  userId: number;
  organisationRole?: OrganisationMemberRole;
};

export const addOrganisationMember = async ({
  organisationId,
  userId,
  organisationRole = OrganisationMemberRole.MEMBER,
}: AddOrganisationMemberOptions) => {
  const [user, organisation, existingMember] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.organisation.findUnique({
      where: { id: organisationId },
      include: {
        groups: {
          where: { type: OrganisationGroupType.INTERNAL_ORGANISATION },
        },
      },
    }),
    prisma.organisationMember.findFirst({
      where: { userId, organisationId },
    }),
  ]);

  if (!user) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'User not found' });
  }

  if (!organisation) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Organisation not found' });
  }

  if (existingMember) {
    return {
      organisationMemberId: existingMember.id,
      userId,
      organisationId,
      alreadyMember: true,
    };
  }

  const organisationMember = await addUserToOrganisation({
    userId,
    organisationId,
    organisationGroups: organisation.groups,
    organisationMemberRole: organisationRole,
    bypassEmail: true,
  });

  return {
    organisationMemberId: organisationMember.id,
    userId,
    organisationId,
    alreadyMember: false,
  };
};
