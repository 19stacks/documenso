import { prisma } from '@documenso/prisma';
import { EnvelopeType, WebhookTriggerEvents } from '@prisma/client';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { mapEnvelopeToWebhookDocumentPayload, ZWebhookDocumentSchema } from '../../types/webhook-payload';
import type { EnvelopeIdOptions } from '../../utils/envelope';
import { triggerWebhook } from '../webhooks/trigger/trigger-webhook';
import { getEnvelopeWhereInput } from './get-envelope-by-id';

export type TriggerEnvelopeUpdatedWebhookOptions = {
  userId: number;
  teamId: number;
  id: EnvelopeIdOptions;
  type: EnvelopeType | null;
};

/**
 * Trigger the envelope/template updated webhook with the current (final)
 * state of the envelope.
 *
 * Use this when the envelope metadata is updated through `updateEnvelope`
 * with `triggerWebhook: false` while recipients/fields are updated
 * separately afterwards — otherwise the webhook would be emitted with a
 * stale recipient set.
 */
export const triggerEnvelopeUpdatedWebhook = async ({
  userId,
  teamId,
  id,
  type,
}: TriggerEnvelopeUpdatedWebhookOptions) => {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id,
    type,
    userId,
    teamId,
  });

  const envelope = await prisma.envelope.findFirst({
    where: envelopeWhereInput,
    include: {
      documentMeta: true,
      recipients: true,
    },
  });

  if (!envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Envelope not found',
    });
  }

  await triggerWebhook({
    event:
      envelope.type === EnvelopeType.TEMPLATE
        ? WebhookTriggerEvents.TEMPLATE_UPDATED
        : WebhookTriggerEvents.ENVELOPE_UPDATED,
    data: ZWebhookDocumentSchema.parse(mapEnvelopeToWebhookDocumentPayload(envelope)),
    userId,
    teamId,
  });
};
