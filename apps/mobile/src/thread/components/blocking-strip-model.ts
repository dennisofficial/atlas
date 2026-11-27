import {
  BLOCKING_SEND_NOTE,
  type BlockingCommand,
  elapsedClockOf,
} from '@dltech/atlas-client/stream'
import { space } from '@dltech/atlas-ui/tokens'

export const STRIP_TUCK = space(5)

export const STRIP_RISE_SPRING = { damping: 22, stiffness: 240, mass: 1 } as const

export const STRIP_SINK_MS = 240

export type StripPresence = {
  readonly command: BlockingCommand | undefined
  readonly leaving: boolean
}

export const HIDDEN_STRIP: StripPresence = { command: undefined, leaving: false }

export const presenceOf = ({
  presence,
  command,
}: {
  presence: StripPresence
  command: BlockingCommand | undefined
}): StripPresence => {
  if (command !== undefined) return { command, leaving: false }
  if (presence.command === undefined) return presence
  return { command: presence.command, leaving: true }
}

export const settledPresenceOf = (presence: StripPresence): StripPresence =>
  presence.leaving ? HIDDEN_STRIP : presence

export const stripRiseOf = ({ height, reduced }: { height: number; reduced: boolean }): number =>
  reduced ? 0 : height

export const stripLabelOf = ({ command, now }: { command: BlockingCommand; now: number }): string =>
  `${command.copy.label}, ${elapsedClockOf({ startedAt: command.startedAt, now })}. ${BLOCKING_SEND_NOTE}`
