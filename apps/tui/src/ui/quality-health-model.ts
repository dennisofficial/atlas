import type { QualityHealth, ThreadId } from '@dltech/atlas-core'

export enum EQualityHealthReadKind {
  Loading = 'loading',
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type QualityHealthRead =
  | { kind: EQualityHealthReadKind.Loading }
  | { kind: EQualityHealthReadKind.Ready; health: QualityHealth }
  | {
      kind: EQualityHealthReadKind.Unavailable
      lastKnown: QualityHealth | null
      reason: string
    }

export type QualityHealthStatusProps = {
  read: QualityHealthRead
  enabled: boolean
  recording: boolean
  threadId: ThreadId
}
