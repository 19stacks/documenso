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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@documenso/ui/primitives/form/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@documenso/ui/primitives/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { PendingDictateRecipient } from '../general/document-signing/document-signing-complete-dialog';
import { DocumentSigningDisclosure } from '../general/document-signing/document-signing-disclosure';

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
  recipientId: z.number({ required_error: 'Please select a recipient' }),
  name: z.string().min(1, 'Name is required'),
  email: zEmail('Invalid email address'),
});

type TNextSignerFormSchema = z.infer<typeof ZNextSignerFormSchema>;

const getDefaultSelectedRecipient = (pendingRecipients: PendingDictateRecipient[], defaultNextSigner?: NextSigner) => {
  if (pendingRecipients.length === 0) {
    return undefined;
  }

  if (defaultNextSigner) {
    const matchedRecipient = pendingRecipients.find(
      (recipient) => recipient.email.toLowerCase() === defaultNextSigner.email.toLowerCase(),
    );

    if (matchedRecipient) {
      return matchedRecipient;
    }
  }

  return pendingRecipients[0];
};

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
  const { t } = useLingui();

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

  const selectedName = form.watch('name');
  const selectedEmail = form.watch('email');

  const onOpenChange = () => {
    if (isSubmitting) {
      return;
    }

    const selectedRecipient = getDefaultSelectedRecipient(pendingRecipients, defaultNextSigner);

    form.reset({
      recipientId: selectedRecipient?.id ?? 0,
      name: selectedRecipient?.name ?? '',
      email: selectedRecipient?.email ?? '',
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
                    <FormField
                      control={form.control}
                      name="recipientId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <Trans>Next Recipient</Trans>
                          </FormLabel>
                          <FormControl>
                            <Select
                              value={field.value ? String(field.value) : undefined}
                              onValueChange={(value) => {
                                const recipientId = Number(value);
                                const selectedRecipient = pendingRecipients.find(
                                  (pendingRecipient) => pendingRecipient.id === recipientId,
                                );

                                field.onChange(recipientId);

                                if (selectedRecipient) {
                                  form.setValue('name', selectedRecipient.name);
                                  form.setValue('email', selectedRecipient.email);
                                }
                              }}
                            >
                              <SelectTrigger className="mt-2">
                                <SelectValue placeholder={t`Select the next signer`} />
                              </SelectTrigger>
                              <SelectContent>
                                {pendingRecipients.map((pendingRecipient) => (
                                  <SelectItem key={pendingRecipient.id} value={String(pendingRecipient.id)}>
                                    {pendingRecipient.name
                                      ? `${pendingRecipient.name} (${pendingRecipient.email})`
                                      : pendingRecipient.email}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex flex-col gap-4 md:flex-row">
                      <div className="flex-1">
                        <p className="font-medium text-sm leading-none">
                          <Trans>Name</Trans>
                        </p>
                        <p className="mt-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
                          {selectedName || '—'}
                        </p>
                      </div>

                      <div className="flex-1">
                        <p className="font-medium text-sm leading-none">
                          <Trans>Email</Trans>
                        </p>
                        <p className="mt-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
                          {selectedEmail || '—'}
                        </p>
                      </div>
                    </div>
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
