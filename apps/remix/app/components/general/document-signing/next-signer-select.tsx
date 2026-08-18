import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@documenso/ui/primitives/form/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@documenso/ui/primitives/select';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import type { PendingDictateRecipient } from './document-signing-complete-dialog';

type NextSignerSelectFormShape = {
  recipientId: number;
  name: string;
  email: string;
};

type NextSignerSelectProps = {
  pendingRecipients: PendingDictateRecipient[];
  nameLabel?: ReactNode;
  emailLabel?: ReactNode;
};

export const NextSignerSelect = ({ pendingRecipients, nameLabel, emailLabel }: NextSignerSelectProps) => {
  const { t } = useLingui();
  const { control, setValue } = useFormContext<NextSignerSelectFormShape>();

  const selectedName = useWatch({ control, name: 'name' });
  const selectedEmail = useWatch({ control, name: 'email' });

  return (
    <div className="flex flex-col gap-4">
      <FormField
        control={control}
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
                    setValue('name', selectedRecipient.name);
                    setValue('email', selectedRecipient.email);
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
          <p className="font-medium text-sm leading-none">{nameLabel ?? <Trans>Name</Trans>}</p>
          <p className="mt-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
            {selectedName || '—'}
          </p>
        </div>

        <div className="flex-1">
          <p className="font-medium text-sm leading-none">{emailLabel ?? <Trans>Email</Trans>}</p>
          <p className="mt-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
            {selectedEmail || '—'}
          </p>
        </div>
      </div>
    </div>
  );
};
