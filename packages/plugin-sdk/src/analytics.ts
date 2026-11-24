export type PodAnalyticsRecord = Readonly<Record<string, string | number | boolean | null>>

export type PodAnalyticsValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly PodAnalyticsRecord[]

export type PodAnalytics = {
  capture(args: { event: string; properties: Readonly<Record<string, PodAnalyticsValue>> }): void
}

export const EMPTY_ANALYTICS: PodAnalytics = Object.freeze({ capture: () => undefined })
