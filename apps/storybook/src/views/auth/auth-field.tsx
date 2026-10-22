import type { ChangeEvent, ReactNode } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@dltech/atlas-ui/components/field";
import { Input } from "@dltech/atlas-ui/components/input";

import { CONTROL_CLASS } from "./auth-controls";

export interface AuthFieldProps {
  id: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  action?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function AuthField({
  id,
  label,
  type = "text",
  autoComplete,
  placeholder,
  value,
  defaultValue,
  onChange,
  action,
  description,
  error,
  disabled,
  autoFocus,
}: AuthFieldProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) =>
    onChange?.(event.target.value);
  const describedBy = error ? `${id}-error` : description ? `${id}-hint` : undefined;

  return (
    <Field data-invalid={error ? true : undefined}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {action && <span className="text-sm">{action}</span>}
      </div>
      <Input
        id={id}
        name={id}
        type={type}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={CONTROL_CLASS}
      />
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        description && <FieldDescription id={`${id}-hint`}>{description}</FieldDescription>
      )}
    </Field>
  );
}
