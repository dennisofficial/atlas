import {
  BLOCKING_SEND_NOTE,
  type BlockingCommand,
  elapsedClockOf,
} from '@dltech/atlas-client/stream'

export const STATUS_SHOW_MS = 320

export const STATUS_HIDE_MS = 280

const GROW_SHARE = 0.6

export type StatusPresence = {
  readonly command: BlockingCommand | undefined
  readonly leaving: boolean
}

export const HIDDEN_STATUS: StatusPresence = { command: undefined, leaving: false }

export const presenceOf = ({
  presence,
  command,
}: {
  presence: StatusPresence
  command: BlockingCommand | undefined
}): StatusPresence => {
  if (command !== undefined) return { command, leaving: false }
  if (presence.command === undefined) return presence
  return { command: presence.command, leaving: true }
}

export const settledPresenceOf = (presence: StatusPresence): StatusPresence =>
  presence.leaving ? HIDDEN_STATUS : presence

const unitOf = (value: number): number => {
  'worklet'
  return Math.min(Math.max(value, 0), 1)
}

export const statusExtentOf = ({
  height,
  shown,
  reduced,
}: {
  height: number
  shown: number
  reduced: boolean
}): number => {
  'worklet'
  if (reduced) return shown > 0 ? height : 0
  return height * unitOf(shown / GROW_SHARE)
}

export const statusOpacityOf = ({
  shown,
  reduced,
}: {
  shown: number
  reduced: boolean
}): number => {
  'worklet'
  if (reduced) return unitOf(shown)
  return unitOf((shown - (1 - GROW_SHARE)) / GROW_SHARE)
}

export const statusLabelOf = ({
  command,
  now,
}: {
  command: BlockingCommand
  now: number
}): string =>
  `${command.copy.label}, ${elapsedClockOf({ startedAt: command.startedAt, now })}. ${BLOCKING_SEND_NOTE}`
