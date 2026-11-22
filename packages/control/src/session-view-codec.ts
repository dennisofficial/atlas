import { initialStatusFacts, type SessionViewState } from '@dltech/atlas-core'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const STATUS_FACT_KEYS = Object.keys(initialStatusFacts)

const hasEveryStatusFact = (facts: Record<string, unknown>): boolean =>
  STATUS_FACT_KEYS.every((key) => key in facts)

const isViewState = (value: unknown): value is SessionViewState =>
  isRecord(value) &&
  typeof value.version === 'number' &&
  typeof value.at === 'number' &&
  isRecord(value.facts) &&
  hasEveryStatusFact(value.facts) &&
  isRecord(value.meter) &&
  isRecord(value.checkouts) &&
  isRecord(value.spend) &&
  isRecord(value.failure) &&
  isRecord(value.pluginViews)

export const encodeViewState = (state: SessionViewState): string => JSON.stringify(state)

export const decodeViewState = (text: string): SessionViewState | undefined => {
  try {
    const parsed: unknown = JSON.parse(text)
    return isViewState(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
