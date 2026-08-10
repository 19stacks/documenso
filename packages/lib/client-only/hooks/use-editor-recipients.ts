import { IS_INSTANCE_CSC_MODE } from '@documenso/lib/constants/app';
import { ZRecipientActionAuthTypesSchema, ZRecipientAuthOptionsSchema } from '@documenso/lib/types/document-auth';
import type { TEditorEnvelope } from '@documenso/lib/types/envelope-editor';
import { ZRecipientEmailSchema } from '@documenso/lib/types/recipient';
import { zodResolver } from '@hookform/resolvers/zod';
import { DocumentSigningOrder, RecipientRole } from '@prisma/client';
import { useId } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import { prop, sortBy } from 'remeda';
import { z } from 'zod';

const LocalRecipientSchema = z
  .object({
    formId: z.string().min(1),
    id: z.number().optional(),
    email: ZRecipientEmailSchema,
    name: z.string(),
    role: z.nativeEnum(RecipientRole),
    signingOrder: z.number().int().positive(),
    actionAuth: z.array(ZRecipientActionAuthTypesSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.id !== undefined) {
      return;
    }

    if (!data.email || data.email.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email is required for new signers.',
        path: ['email'],
      });
    }

    if (!data.name || data.name.trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Name must be at least 3 characters.',
        path: ['name'],
      });
    }
  });

type TLocalRecipient = z.infer<typeof LocalRecipientSchema>;

/**
 * Backstop validation that mirrors the CSC-mode UI overrides in
 * `EnvelopeEditorProvider`. If anything bypasses the disabled controls (URL
 * tampering, legacy form state, embedded host) the form refuses to submit
 * rather than persisting values the TSP flow can't honour.
 */
export const ZEditorRecipientsFormSchema = z
  .object({
    signers: z.array(LocalRecipientSchema),
    signingOrder: z.nativeEnum(DocumentSigningOrder),
    allowDictateNextSigner: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    const seen = new Map<string, number>();

    data.signers.forEach((signer, i) => {
      const email = signer.email?.trim().toLowerCase();
      if (!email) {
        return;
      }

      if (seen.has(email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each signer must have a unique email address.',
          path: ['signers', i, 'email'],
        });
      } else {
        seen.set(email, i);
      }
    });

    if (!IS_INSTANCE_CSC_MODE()) {
      return;
    }

    if (data.signingOrder !== DocumentSigningOrder.SEQUENTIAL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CSC envelopes must use SEQUENTIAL signing order.',
        path: ['signingOrder'],
      });
    }

    if (data.allowDictateNextSigner) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CSC envelopes do not support next-signer dictation.',
        path: ['allowDictateNextSigner'],
      });
    }

    data.signers.forEach((signer, index) => {
      if (signer.role === RecipientRole.ASSISTANT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CSC envelopes do not support the assistant role.',
          path: ['signers', index, 'role'],
        });
      }
    });
  });

export type TEditorRecipientsFormSchema = z.infer<typeof ZEditorRecipientsFormSchema>;

type EditorRecipientsProps = {
  envelope: TEditorEnvelope;
};

type ResetFormOptions = {
  recipients?: TEditorEnvelope['recipients'];
  documentMeta?: TEditorEnvelope['documentMeta'];
};

type UseEditorRecipientsResponse = {
  form: UseFormReturn<TEditorRecipientsFormSchema>;
  resetForm: (options?: ResetFormOptions) => void;
};

export const useEditorRecipients = ({ envelope }: EditorRecipientsProps): UseEditorRecipientsResponse => {
  const initialId = useId();

  const generateDefaultValues = (options?: ResetFormOptions) => {
    const { recipients, documentMeta } = options ?? {};

    const formRecipients = (recipients || envelope.recipients).map((recipient, index) => ({
      id: recipient.id,
      formId: String(recipient.id),
      name: recipient.name,
      email: recipient.email,
      role: recipient.role,
      // Treat 0/negative as missing — `??` alone keeps 0 and breaks the order UI.
      signingOrder: recipient.signingOrder && recipient.signingOrder > 0 ? recipient.signingOrder : index + 1,
      actionAuth: ZRecipientAuthOptionsSchema.parse(recipient.authOptions)?.actionAuth ?? undefined,
    }));

    const signers: TLocalRecipient[] =
      formRecipients.length > 0
        ? sortBy(formRecipients, [prop('signingOrder'), 'asc'], [prop('id'), 'asc']).map((recipient, index) => ({
            ...recipient,
            signingOrder: index + 1,
          }))
        : [
            {
              formId: initialId,
              name: '',
              email: '',
              role: RecipientRole.SIGNER,
              signingOrder: 1,
              actionAuth: [],
            },
          ];

    return {
      signers,
      signingOrder: documentMeta?.signingOrder ?? envelope.documentMeta.signingOrder,
      allowDictateNextSigner: documentMeta?.allowDictateNextSigner ?? envelope.documentMeta.allowDictateNextSigner,
    };
  };

  const form = useForm<TEditorRecipientsFormSchema>({
    defaultValues: generateDefaultValues(),
    resolver: zodResolver(ZEditorRecipientsFormSchema),
    // Validate on explicit trigger (e.g. Add Fields) — autosave uses safeParse separately.
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
  });

  const resetForm = (options?: ResetFormOptions) => {
    form.reset(generateDefaultValues(options));
  };

  return {
    form,
    resetForm,
  };
};
