import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dltech/atlas-ui/components/select";

import { QUIET_HOUR_OPTIONS } from "../../../fixtures/settings-interface";

export function QuietHourSelect({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <Select
      items={QUIET_HOUR_OPTIONS}
      value={value}
      disabled={disabled}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger size="sm" className="w-24 font-mono" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {QUIET_HOUR_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value} className="font-mono">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
