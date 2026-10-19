import type { ValueProvider } from '@nestjs/common'

import { runsOnVercel } from '../../../_lib/background-work/background-work.providers'

export const WAKE_DEBOUNCE_MS = 5_000

export const WAKE_DEBOUNCE = Symbol('WAKE_DEBOUNCE')

export function wakeDebounceProvider(): ValueProvider<number> {
  return { provide: WAKE_DEBOUNCE, useValue: runsOnVercel() ? 0 : WAKE_DEBOUNCE_MS }
}
