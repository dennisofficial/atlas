import type { ResourceSnapshot } from '@dltech/atlas-core'

export enum ELoadReason {
  Missing = 'missing',
  Changed = 'changed',
  Reconnect = 'reconnect',
  Cloud = 'cloud',
  ValueStale = 'value-stale',
}

export enum ERefreshTrigger {
  Start = 'start',
  Reconnect = 'reconnect',
  AfterTurn = 'after-turn',
}

export enum EWaitReason {
  Missing = 'missing',
  Cloud = 'cloud',
}

const UNARMED = 'unarmed'

const componentOf = (args: { fingerprint: string; index: number }): string | undefined =>
  args.fingerprint.split(':')[args.index]

const seqOf = (seq: number | undefined): string => (seq === undefined ? UNARMED : `${seq}`)

export const reasonOf = (args: {
  latest: ResourceSnapshot | undefined
  staledByValue: boolean
  instance: string
  seq: number | undefined
}): ELoadReason => {
  const { latest } = args
  if (latest === undefined) return ELoadReason.Missing
  if (args.staledByValue) return ELoadReason.ValueStale
  if (componentOf({ fingerprint: latest.fingerprint, index: 0 }) !== args.instance) {
    return ELoadReason.Reconnect
  }
  if (componentOf({ fingerprint: latest.fingerprint, index: 1 }) !== seqOf(args.seq)) {
    return ELoadReason.Changed
  }
  return ELoadReason.Cloud
}
