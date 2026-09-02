import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { RecipientRole } from '@prisma/client';

export const RECIPIENT_ROLES_DESCRIPTION = {
  [RecipientRole.APPROVER]: {
    actionVerb: msg({
      message: `Approve`,
      context: `Recipient role action verb`,
    }),
    actioned: msg({
      message: `Approved`,
      context: `Recipient role actioned`,
    }),
    progressiveVerb: msg({
      message: `Approving`,
      context: `Recipient role progressive verb`,
    }),
    roleName: msg({
      message: `Approver`,
      context: `Recipient role name`,
    }),
    roleNamePlural: msg({
      message: `Approvers`,
      context: `Recipient role plural name`,
    }),
  },
  [RecipientRole.CC]: {
    actionVerb: msg({
      message: `CC`,
      context: `Recipient role action verb`,
    }),
    actioned: msg({
      message: `CC'd`,
      context: `Recipient role actioned`,
    }),
    progressiveVerb: msg({
      message: `CC`,
      context: `Recipient role progressive verb`,
    }),
    roleName: msg({
      message: `Cc`,
      context: `Recipient role name`,
    }),
    roleNamePlural: msg({
      message: `Ccers`,
      context: `Recipient role plural name`,
    }),
  },
  [RecipientRole.SIGNER]: {
    actionVerb: msg({
      message: `Sign`,
      context: `Recipient role action verb`,
    }),
    actioned: msg({
      message: `Signed`,
      context: `Recipient role actioned`,
    }),
    progressiveVerb: msg({
      message: `Signing`,
      context: `Recipient role progressive verb`,
    }),
    roleName: msg({
      message: `Signer`,
      context: `Recipient role name`,
    }),
    roleNamePlural: msg({
      message: `Signers`,
      context: `Recipient role plural name`,
    }),
  },
  [RecipientRole.VIEWER]: {
    actionVerb: msg({
      message: `View`,
      context: `Recipient role action verb`,
    }),
    actioned: msg({
      message: `Viewed`,
      context: `Recipient role actioned`,
    }),
    progressiveVerb: msg({
      message: `Viewing`,
      context: `Recipient role progressive verb`,
    }),
    roleName: msg({
      message: `Viewer`,
      context: `Recipient role name`,
    }),
    roleNamePlural: msg({
      message: `Viewers`,
      context: `Recipient role plural name`,
    }),
  },
  [RecipientRole.ASSISTANT]: {
    actionVerb: msg({
      message: `Assist`,
      context: `Recipient role action verb`,
    }),
    actioned: msg({
      message: `Assisted`,
      context: `Recipient role actioned`,
    }),
    progressiveVerb: msg({
      message: `Assisting`,
      context: `Recipient role progressive verb`,
    }),
    roleName: msg({
      message: `Assistant`,
      context: `Recipient role name`,
    }),
    roleNamePlural: msg({
      message: `Assistants`,
      context: `Recipient role plural name`,
    }),
  },
} satisfies Record<keyof typeof RecipientRole, unknown>;

export const RECIPIENT_ROLE_TO_DISPLAY_TYPE = {
  [RecipientRole.SIGNER]: `SIGNING_REQUEST`,
  [RecipientRole.VIEWER]: `VIEW_REQUEST`,
  [RecipientRole.APPROVER]: `APPROVE_REQUEST`,
} as const;

export const RECIPIENT_ROLE_TO_EMAIL_TYPE = {
  [RecipientRole.SIGNER]: `SIGNING_REQUEST`,
  [RecipientRole.VIEWER]: `VIEW_REQUEST`,
  [RecipientRole.APPROVER]: `APPROVE_REQUEST`,
  [RecipientRole.ASSISTANT]: `ASSISTING_REQUEST`,
} as const;

/**
 * Pre-computed button labels for the SendGrid dynamic templates.
 *
 * Sent as part of `dynamicTemplateData` so the template only uses simple
 * `{{#if}}` conditions instead of string comparison helpers.
 */
export const RECIPIENT_ROLE_TO_EMAIL_BUTTON_LABEL = {
  [RecipientRole.SIGNER]: 'View Document to sign',
  [RecipientRole.VIEWER]: 'View Document',
  [RecipientRole.APPROVER]: 'View Document to approve',
  [RecipientRole.ASSISTANT]: 'View Document to assist',
  [RecipientRole.CC]: '',
} as const;

/**
 * Pre-computed subtext lines for the SendGrid dynamic templates.
 *
 * Sent as part of `dynamicTemplateData` so the template only uses simple
 * `{{#if}}` conditions instead of string comparison helpers.
 */
export const RECIPIENT_ROLE_TO_EMAIL_SUBTEXT = {
  [RecipientRole.SIGNER]: 'Continue by signing the document.',
  [RecipientRole.VIEWER]: 'Continue by viewing the document.',
  [RecipientRole.APPROVER]: 'Continue by approving the document.',
  [RecipientRole.ASSISTANT]: 'Continue by assisting with the document.',
  [RecipientRole.CC]: '',
} as const;

/**
 * Pre-computed button labels for the signing reminder SendGrid dynamic
 * template.
 *
 * Distinct from `RECIPIENT_ROLE_TO_EMAIL_BUTTON_LABEL`: the reminder email
 * uses shorter labels ("Sign Document" instead of "View Document to sign").
 */
export const RECIPIENT_ROLE_TO_REMINDER_BUTTON_LABEL = {
  [RecipientRole.SIGNER]: 'Sign Document',
  [RecipientRole.VIEWER]: 'View Document',
  [RecipientRole.APPROVER]: 'Approve Document',
  [RecipientRole.ASSISTANT]: 'Assist Document',
  [RecipientRole.CC]: '',
} as const;

export const RECIPIENT_ROLE_SIGNING_REASONS = {
  [RecipientRole.SIGNER]: msg`I am a signer of this document`,
  [RecipientRole.APPROVER]: msg`I am an approver of this document`,
  [RecipientRole.CC]: msg`I am required to receive a copy of this document`,
  [RecipientRole.VIEWER]: msg`I am a viewer of this document`,
  [RecipientRole.ASSISTANT]: msg`I am an assistant of this document`,
} satisfies Record<keyof typeof RecipientRole, MessageDescriptor>;
