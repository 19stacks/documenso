import { cn } from '@documenso/ui/lib/utils';
import { Input } from '@documenso/ui/primitives/input';
import { type ComponentPropsWithoutRef, useEffect, useRef, useState } from 'react';

export type SigningOrderInputProps = {
  value: number | undefined;
  index: number;
  disabled?: boolean;
  onCommit: (index: number, order: string) => void;
  onRestore: (index: number) => void;
};

/**
 * Local-state order input so clearing/rewriting digits is not blocked by RHF
 * (undefined values) or list reordering while the user is still typing.
 */
export const SigningOrderInput = ({
  value,
  index,
  disabled,
  onCommit,
  onRestore,
  ...props
}: SigningOrderInputProps & ComponentPropsWithoutRef<'input'>) => {
  const [text, setText] = useState(() => (value != null ? String(value) : ''));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setText(value != null ? String(value) : '');
    }
  }, [value]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      data-testid="signing-order-input"
      className={cn(
        'w-10 text-center',
        '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        props.className,
      )}
      disabled={disabled}
      value={text}
      onFocus={(event) => {
        isFocusedRef.current = true;
        props.onFocus?.(event);
      }}
      onKeyDown={(event) => {
        // Stop drag-and-drop / parent handlers from swallowing edit keys.
        event.stopPropagation();
        props.onKeyDown?.(event);
      }}
      onChange={(event) => {
        event.stopPropagation();

        const rawValue = event.target.value;

        if (rawValue === '' || /^\d+$/.test(rawValue)) {
          setText(rawValue);
        }
      }}
      onBlur={(event) => {
        isFocusedRef.current = false;

        const trimmed = text.trim();
        const parsedOrder = Number(trimmed);

        if (!trimmed || !Number.isInteger(parsedOrder) || parsedOrder < 1) {
          setText(value != null ? String(value) : String(index + 1));
          onRestore(index);
        } else {
          onCommit(index, trimmed);
        }

        props.onBlur?.(event);
      }}
    />
  );
};
