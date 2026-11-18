import type { ValueProvider } from '@nestjs/common'

export const WAKE_DEBOUNCE_MS = 5_000

export const WAKE_DEBOUNCE = Symbol('WAKE_DEBOUNCE')

export function wakeDebounceProvider(): ValueProvider<number> {
  return { provide: WAKE_DEBOUNCE, useValue: WAKE_DEBOUNCE_MS }
}
