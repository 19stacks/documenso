import { env } from '@documenso/lib/utils/env';
import { logger } from '@documenso/lib/utils/logger';
import type { AttachmentData } from '@sendgrid/helpers/classes/attachment';
import type { EmailData } from '@sendgrid/helpers/classes/email-address';
import type { MailDataRequired } from '@sendgrid/helpers/classes/mail';
import sgMail from '@sendgrid/mail';
import type { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';

/**
 * SendGrid dynamic template ids, keyed by email type.
 *
 * Each id is read from its own environment variable. When the value is empty
 * the email type is not sent through SendGrid and falls back to the
 * React-rendered HTML via the configured transporter.
 */
export const SENDGRID_TEMPLATE_IDS = {
  'document-invite': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_INVITE'),
  'document-pending': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_PENDING'),
  'document-reminder': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_REMINDER'),
  'document-completed': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_COMPLETED'),
  'document-rejected': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_REJECTED'),
  'document-rejection-confirmed': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_REJECTION_CONFIRMED'),
  'document-cancelled': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_CANCELLED'),
  'document-deleted': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_DOCUMENT_DELETED'),
  'recipient-signed': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_RECIPIENT_SIGNED'),
  'recipient-expired': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_RECIPIENT_EXPIRED'),
  'recipient-removed': env('NEXT_PRIVATE_SENDGRID_TEMPLATE_RECIPIENT_REMOVED'),
} as const;

const SENDGRID_API_KEY = env('NEXT_PRIVATE_SENDGRID_API_KEY');

let isSendGridInitialized = false;

const initSendGrid = () => {
  if (isSendGridInitialized || !SENDGRID_API_KEY) {
    return;
  }

  sgMail.setApiKey(SENDGRID_API_KEY);
  isSendGridInitialized = true;
};

/**
 * Whether a dynamic template can be used to send an email.
 *
 * Mirrors the onboard-crm backend pattern: SendGrid is only used when both the
 * API key and a template id are configured.
 */
export const isSendGridDynamicTemplateConfigured = (templateId?: string): boolean => {
  return Boolean(SENDGRID_API_KEY && templateId);
};

type SendGridFallbackMailOptions = Mail.Options & {
  to: NonNullable<Mail.Options['to']>;
  from: NonNullable<Mail.Options['from']>;
};

type TSendEmailWithSendGridOrFallbackOptions = SendGridFallbackMailOptions & {
  transporter: Transporter;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
};

/**
 * Sends an email through the SendGrid dynamic template matching `templateId`
 * when one is configured, otherwise through the provided transporter.
 *
 * The SendGrid payload never includes a `subject`: dynamic templates own their
 * own subject line. On any SendGrid failure the React-rendered `html`/`text`
 * are sent via the transporter as a fallback.
 */
export const sendEmailWithSendGridOrFallback = async (
  options: TSendEmailWithSendGridOrFallbackOptions,
): Promise<void> => {
  const { transporter, templateId, dynamicTemplateData, ...mail } = options;

  if (templateId && isSendGridDynamicTemplateConfigured(templateId)) {
    try {
      initSendGrid();

      // Note: `cc`/`bcc` from the mail options are intentionally not mapped to
      // SendGrid — no current email uses them and dynamic templates own their
      // own content. If a future email needs cc/bcc, map them here via
      // `personalizations`.
      const sendGridMailData: MailDataRequired = {
        to: toSendGridAddresses(mail.to),
        from: toSendGridEmailAddress(mail.from),
        templateId,
        dynamicTemplateData,
      };

      if (mail.replyTo) {
        sendGridMailData.replyTo = toSendGridEmailAddress(mail.replyTo);
      }

      const attachments = toSendGridAttachments(mail.attachments);

      if (attachments) {
        sendGridMailData.attachments = attachments;
      }

      const headers = toSendGridHeaders(mail.headers);

      if (headers) {
        sendGridMailData.headers = headers;
      }

      logger.info(
        {
          templateId,
          to: sendGridMailData.to,
          from: sendGridMailData.from,
          attachmentCount: attachments?.length ?? 0,
        },
        'Sending email via SendGrid dynamic template',
      );

      // Full template data is logged at debug level to avoid leaking recipient
      // names and document titles into the standard (info) logs.
      logger.debug(
        {
          templateId,
          replyTo: sendGridMailData.replyTo,
          dynamicTemplateData,
        },
        'SendGrid dynamic template data',
      );

      await sgMail.send(sendGridMailData);

      return;
    } catch (error) {
      logger.warn(
        {
          err: error,
          templateId,
          dynamicTemplateData,
        },
        'SendGrid dynamic template send failed; falling back to the React rendered email',
      );
    }
  }

  await transporter.sendMail(mail);
};

const toSendGridEmailAddress = (address: NonNullable<Mail.Options['from'] | Mail.Options['replyTo']>): EmailData => {
  const entry = Array.isArray(address) ? address[0] : address;

  if (typeof entry === 'string') {
    return entry;
  }

  return {
    email: entry.address,
    name: entry.name,
  };
};

const toSendGridAddresses = (address: NonNullable<Mail.Options['to']>): EmailData | EmailData[] => {
  if (Array.isArray(address)) {
    return address.map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      return {
        email: entry.address,
        name: entry.name,
      };
    });
  }

  if (typeof address === 'string') {
    return address;
  }

  return {
    email: address.address,
    name: address.name,
  };
};

const toSendGridAttachments = (attachments: Mail.Options['attachments']): AttachmentData[] | undefined => {
  if (!attachments) {
    return undefined;
  }

  const converted: AttachmentData[] = [];

  for (const attachment of attachments) {
    if (typeof attachment.content !== 'string' && !Buffer.isBuffer(attachment.content)) {
      continue;
    }

    converted.push({
      content: typeof attachment.content === 'string' ? attachment.content : attachment.content.toString('base64'),
      filename: attachment.filename || 'attachment',
      type: attachment.contentType,
    });
  }

  return converted.length > 0 ? converted : undefined;
};

const toSendGridHeaders = (headers: Mail.Options['headers']): Record<string, string> | undefined => {
  if (!headers || Array.isArray(headers)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value];
      }

      if (Array.isArray(value)) {
        return [key, value.join(', ')];
      }

      return [key, value.value];
    }),
  );
};
