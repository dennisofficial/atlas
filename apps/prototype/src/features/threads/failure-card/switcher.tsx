'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { FAILURE_SCENARIOS, type EFailureScenario } from './scenarios'

export interface VariantInfo {
  key: string
  name: string
}

export function PrototypeSwitcher({
  variants,
  current,
  scenario,
}: {
  variants: VariantInfo[]
  current: string
  scenario: EFailureScenario
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`)
  }
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  )
  const step = (delta: number) => {
    const target = variants[(index + delta + variants.length) % variants.length]
    if (target) setParam('variant', target.key)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]'))
        return
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  if (process.env.NODE_ENV === 'production') return null
  const active = variants[index]
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-2 py-1.5 text-xs text-background shadow-lg">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="rounded-full p-1 hover:bg-background/20"
      >
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="min-w-44 text-center font-medium">
        {active?.key} — {active?.name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => step(1)}
        className="rounded-full p-1 hover:bg-background/20"
      >
        <ChevronRightIcon className="size-4" />
      </button>
      <span className="h-4 w-px bg-background/30" />
      <select
        aria-label="Scenario"
        value={scenario}
        onChange={(event) => setParam('state', event.target.value)}
        className="rounded-md bg-transparent py-1 text-xs outline-none"
      >
        {FAILURE_SCENARIOS.map((item) => (
          <option key={item.id} value={item.id} className="text-foreground">
            {item.label}
          </option>
        ))}
      </select>
    </div>
  )
}
