'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#components/select'

export const POD_DISK_GROW_SIZES: readonly number[] = [30, 40, 60, 80, 100]

export function podDiskGrowOptionsOf(args: { limitGb: number }): number[] {
  const currentGb = Math.round(args.limitGb)
  return POD_DISK_GROW_SIZES.filter((size) => size > currentGb)
}

export interface PodDiskControlProps {
  limitGb: number | undefined
  disabled?: boolean | undefined
  onGrow?: ((diskGb: number) => void) | undefined
}

export function PodDiskSelect(props: PodDiskControlProps) {
  const limitGb = props.limitGb
  const known = limitGb !== undefined
  const options = limitGb === undefined ? [] : podDiskGrowOptionsOf({ limitGb })
  if (known && options.length === 0) return null

  const handleValueChange = (next: unknown) => {
    const picked = options.find((size) => size === next)
    if (picked === undefined) return
    props.onGrow?.(picked)
  }

  const currentGb = limitGb === undefined ? undefined : Math.round(limitGb)
  const sizes = currentGb === undefined ? [] : [currentGb, ...options]

  return (
    <Select
      items={sizes.map((size) => ({ value: size, label: `${size} GB` }))}
      value={currentGb ?? null}
      onValueChange={handleValueChange}
      disabled={props.disabled === true || !known}
    >
      <SelectTrigger size="sm" aria-label="Disk size" className="shrink-0 text-xs">
        <SelectValue placeholder="Disk" />
      </SelectTrigger>
      <SelectContent align="end" className="w-auto min-w-(--anchor-width)">
        {sizes.map((size) => (
          <SelectItem key={size} value={size} disabled={size === currentGb}>
            {size} GB
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
