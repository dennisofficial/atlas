import type { SessionViewState } from '@dltech/atlas-core'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isViewState = (value: unknown): value is SessionViewState =>
  isRecord(value) &&
  typeof value.version === 'number' &&
  typeof value.at === 'number' &&
  isRecord(value.facts) &&
  isRecord(value.meter) &&
  isRecord(value.checkouts) &&
  isRecord(value.pullRequests) &&
  isRecord(value.spend)

export const encodeViewState = (state: SessionViewState): string => JSON.stringify(state)

export const decodeViewState = (text: string): SessionViewState | undefined => {
  try {
    const parsed: unknown = JSON.parse(text)
    return isViewState(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
