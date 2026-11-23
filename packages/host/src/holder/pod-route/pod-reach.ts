import type { PodStreamCloseReason } from '@dltech/atlas-protocol'

export enum EPodReach {
  Local = 'local',
  Remote = 'remote',
  Unreachable = 'unreachable',
}

export type PodReach =
  | { kind: EPodReach.Local }
  | { kind: EPodReach.Remote; hostId: number }
  | { kind: EPodReach.Unreachable }

export type PodFollowClose = PodStreamCloseReason
