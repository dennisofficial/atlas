'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

import { useAnnounceControls } from './bridge'

export type Control =
  | { type: 'select'; label: string; options: readonly string[]; default: string }
  | { type: 'boolean'; label: string; default: boolean }
  | { type: 'range'; label: string; min: number; max: number; step?: number; default: number }

export type Values<C extends Record<string, Control>> = {
  [K in keyof C]: C[K] extends { type: 'boolean' }
    ? boolean
    : C[K] extends { type: 'range' }
      ? number
      : string
}

type ParamSource = Pick<URLSearchParams, 'get'>

const TRUE_LITERALS = ['true', '1']
const FALSE_LITERALS = ['false', '0']

function parseControl({ control, raw }: { control: Control; raw: string | null }) {
  if (raw === null) return control.default
  if (control.type === 'select') return control.options.includes(raw) ? raw : control.default
  if (control.type === 'boolean') {
    if (TRUE_LITERALS.includes(raw)) return true
    return FALSE_LITERALS.includes(raw) ? false : control.default
  }
  const value = raw.trim() === '' ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) return control.default
  return Math.min(control.max, Math.max(control.min, value))
}

export function parseControls<C extends Record<string, Control>>({
  controls,
  params,
}: {
  controls: C
  params: ParamSource
}): Values<C> {
  const entries = Object.entries(controls).map(([key, control]) => [
    key,
    parseControl({ control, raw: params.get(key) }),
  ])
  return Object.fromEntries(entries) as Values<C>
}

export function usePrototype<C extends Record<string, Control>>(controls: C): Values<C> {
  const params = useSearchParams()
  const signature = params.toString()
  const values = useMemo(() => parseControls({ controls, params }), [signature])
  useAnnounceControls({ controls, values })
  return values
}
