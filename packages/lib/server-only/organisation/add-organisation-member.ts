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
  const [user, organisation] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.organisation.findUnique({
      where: { id: organisationId },
      include: {
        groups: {
          where: { type: OrganisationGroupType.INTERNAL_ORGANISATION },
        },
      },
    }),
  ]);

  if (!user) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'User not found' });
  }

  if (!organisation) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Organisation not found' });
  }

  const existingMember = await prisma.organisationMember.findFirst({
    where: { userId, organisationId },
  });

  if (existingMember) {
    return {
      organisationMemberId: existingMember.id,
      userId,
      organisationId,
      alreadyMember: true,
    };
  }

  await addUserToOrganisation({
    userId,
    organisationId,
    organisationGroups: organisation.groups,
    organisationMemberRole: organisationRole,
    bypassEmail: true,
  });

  const organisationMember = await prisma.organisationMember.findFirstOrThrow({
    where: { userId, organisationId },
  });

  return {
    organisationMemberId: organisationMember.id,
    userId,
    organisationId,
    alreadyMember: false,
  };
};
