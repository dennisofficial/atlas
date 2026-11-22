'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { useCheckoutChoice } from './checkout-choice-context'

const isCheckoutId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

export function CheckoutSelect() {
  const { changes, options, selectedId, select } = useCheckoutChoice()
  const handleValueChange = (next: unknown) => {
    if (isCheckoutId(next)) select(next)
  }
  if (changes.status !== 'ready' || options.length < 2) return null
  return (
    <Select
      items={options.map((option) => ({ value: option.id, label: option.label }))}
      value={selectedId}
      onValueChange={handleValueChange}
    >
      <SelectTrigger
        data-checkout-select
        size="sm"
        variant="ghost"
        aria-label="Checkout"
        className="max-w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} title={option.path}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
