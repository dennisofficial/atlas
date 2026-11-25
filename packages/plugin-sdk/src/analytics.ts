export type PodAnalyticsRecord = Readonly<Record<string, string | number | boolean | null>>

export type PodAnalyticsValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly PodAnalyticsRecord[]

export enum EAnalyticsLinks {
  Raw = 'raw',
  Hashed = 'hashed',
}

export enum EAnalyticsThreadKind {
  Main = 'main',
  SubAgent = 'sub_agent',
  Teammate = 'teammate',
}

export type PodAnalytics = {
  capture(args: {
    event: string
    properties: Readonly<Record<string, PodAnalyticsValue>>
    links?: EAnalyticsLinks
  }): void
}

export const EMPTY_ANALYTICS: PodAnalytics = Object.freeze({ capture: () => undefined })
