import type { WireThread } from '@dltech/atlas-wire/web'

export enum ELocalActivityState {
  Available = 'available',
  Unavailable = 'unavailable',
}

export type LocalAvailability = {
  lastAssistantSeq: number | null
  readSeq?: number | null
} & (
  | { activityState: ELocalActivityState.Available; readSeq: number | null }
  | { activityState: ELocalActivityState.Unavailable; reason: string }
)

export type ThreadDisplay = WireThread & { localAvailability?: LocalAvailability }

export function activityUnavailableReason(thread: ThreadDisplay | undefined): string | undefined {
  const availability = thread?.localAvailability
  return availability?.activityState === ELocalActivityState.Unavailable
    ? availability.reason
    : undefined
}
