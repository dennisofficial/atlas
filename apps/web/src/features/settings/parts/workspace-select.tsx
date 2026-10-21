'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { SelectOption } from '../fixtures/settings-workspace'

export function WorkspaceSelect({
  value,
  options,
  onChange,
  label,
  size = 'default',
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  label: string
  size?: 'sm' | 'default'
  className?: string
}) {
  const handleValueChange = (next: string | null) => {
    if (next !== null) onChange(next)
  }
  return (
    <Select items={options} value={value} onValueChange={handleValueChange}>
      <SelectTrigger size={size} aria-label={label} className={cn('w-64', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
