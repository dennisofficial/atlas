import { useState } from 'react'

interface ToggledArgs<T> {
  value?: T[]
  defaultValue?: T[]
  onChange?: (next: T[]) => void
}

export function useToggled<T>({ value, defaultValue, onChange }: ToggledArgs<T>) {
  const [internal, setInternal] = useState<T[]>(defaultValue ?? [])
  const current = value ?? internal

  const toggle = (item: T) => {
    const next = current.includes(item)
      ? current.filter((entry) => entry !== item)
      : [...current, item]
    setInternal(next)
    onChange?.(next)
  }

  return { current, toggle }
}
