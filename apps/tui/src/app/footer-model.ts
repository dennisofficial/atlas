import { EEffort, contextPressure } from '@dltech/atlas-core'

import type { FooterItem } from '../ui/footer-item'
import {
  footerLayout,
  type FooterContext,
  type FooterEffort,
  type FooterLayout,
} from '../ui/footer-layout'
import type { SessionContextReading } from './session-view'

export const effortOf = (name: string): EEffort =>
  Object.values(EEffort).find((one) => one === name) ?? EEffort.Medium

export const footerContextOf = (reading: SessionContextReading | null): FooterContext => {
  if (reading === null || reading.used === null) return { percent: null }

  const pressure = contextPressure({ used: reading.used, window: reading.limit })
  return { percent: pressure.percent, tokensUsed: pressure.used }
}

export const footerLayoutOf = (args: {
  width: number
  model: string
  effort: FooterEffort
  fast: boolean
  items: readonly FooterItem[]
  context: FooterContext
}): FooterLayout =>
  footerLayout({
    width: args.width,
    model: args.model,
    effort: args.effort,
    fast: args.fast,
    items: args.items,
    context: args.context,
  })
