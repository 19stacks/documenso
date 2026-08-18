import { getDefaultSelectedRecipient } from '@documenso/lib/utils/recipients';
import { zEmail } from '@documenso/lib/utils/zod';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { Form } from '@documenso/ui/primitives/form/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans } from '@lingui/react/macro';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { PendingDictateRecipient } from '../general/document-signing/document-signing-complete-dialog';
import { DocumentSigningDisclosure } from '../general/document-signing/document-signing-disclosure';
import { NextSignerSelect } from '../general/document-signing/next-signer-select';

export type NextSigner = {
  name: string;
  email: string;
};

type ConfirmationDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (nextSigner?: NextSigner) => void;
  hasUninsertedFields: boolean;
  isSubmitting: boolean;
  allowDictateNextSigner?: boolean;
  pendingRecipients?: PendingDictateRecipient[];
  defaultNextSigner?: NextSigner;
};

const ZNextSignerFormSchema = z.object({
  recipientId: z.number({ required_error: 'Please select a recipient' }).int().positive(),
  name: z.string().min(1, 'Name is required'),
  email: zEmail('Invalid email address'),
});

type TNextSignerFormSchema = z.infer<typeof ZNextSignerFormSchema>;

export function AssistantConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  hasUninsertedFields,
  isSubmitting,
  allowDictateNextSigner = false,
  pendingRecipients = [],
  defaultNextSigner,
}: ConfirmationDialogProps) {
  const showDictateNextSigner = allowDictateNextSigner && pendingRecipients.length > 0;

  const defaultSelectedRecipient = useMemo(
    () => getDefaultSelectedRecipient(pendingRecipients, defaultNextSigner),
    [pendingRecipients, defaultNextSigner],
  );

  const form = useForm<TNextSignerFormSchema>({
    resolver: zodResolver(ZNextSignerFormSchema),
    values: {
      recipientId: defaultSelectedRecipient?.id ?? 0,
      name: defaultSelectedRecipient?.name ?? '',
      email: defaultSelectedRecipient?.email ?? '',
    },
  });

  const onOpenChange = () => {
    if (isSubmitting) {
      return;
    }

    form.reset({
      recipientId: defaultSelectedRecipient?.id ?? 0,
      name: defaultSelectedRecipient?.name ?? '',
      email: defaultSelectedRecipient?.email ?? '',
    });

    onClose();
  };

  const handleSubmit = () => {
    // Validate the form and submit it if dictate signer is enabled.
    if (showDictateNextSigner) {
      void form.handleSubmit((data) => onConfirm({ name: data.name, email: data.email }))();
      return;
    }

    onConfirm();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form>
            <fieldset disabled={isSubmitting} className="border-none p-0">
              <DialogHeader>
                <DialogTitle>
                  <Trans>Complete Document</Trans>
                </DialogTitle>
                <DialogDescription>
                  <Trans>
                    Are you sure you want to complete the document? This action cannot be undone. Please ensure that you
                    have completed prefilling all relevant fields before proceeding.
                  </Trans>
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 flex flex-col gap-4">
                {showDictateNextSigner && (
                  <div className="mt-4 flex flex-col gap-4">
                    <NextSignerSelect pendingRecipients={pendingRecipients} />
                  </div>
                )}

                <DocumentSigningDisclosure className="mt-4" />
              </div>

              <DialogFooter className="mt-4">
                <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  type="button"
                  variant={hasUninsertedFields ? 'destructive' : 'default'}
                  disabled={isSubmitting}
                  onClick={handleSubmit}
                  loading={isSubmitting}
                >
                  {hasUninsertedFields ? <Trans>Proceed</Trans> : <Trans>Continue</Trans>}
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
