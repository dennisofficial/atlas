'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#components/select'

import { ramOf } from './pod-status'

export interface VcpuSizeOption {
  value: string
  label: string
  detail?: string
}

export interface VcpuSizeSelectProps {
  sizes: readonly number[]
  value: string
  onValueChange: (value: string) => void
  options?: readonly VcpuSizeOption[]
  disabled?: boolean
  'aria-label'?: string
  id?: string
}

export function vcpuSizeItems({
  sizes,
  options,
}: {
  sizes: readonly number[]
  options?: readonly VcpuSizeOption[]
}): VcpuSizeOption[] {
  return [
    ...(options ?? []),
    ...sizes.map((vcpus) => ({
      value: String(vcpus),
      label: `${vcpus} vCPU`,
      detail: `${ramOf(vcpus)} GB RAM`,
    })),
  ]
}

export function VcpuSizeSelect({
  sizes,
  value,
  onValueChange,
  options,
  disabled,
  'aria-label': ariaLabel = 'vCPUs',
  id,
}: VcpuSizeSelectProps) {
  const handleValueChange = (next: unknown) => {
    if (typeof next === 'string') onValueChange(next)
  }
  const items = vcpuSizeItems({ sizes, options })

  return (
    <Select
      items={items.map((item) => ({ value: item.value, label: item.label }))}
      value={value}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger id={id} size="sm" className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
            {item.detail === undefined ? null : (
              <span className="font-mono text-xs text-muted-foreground">{item.detail}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
