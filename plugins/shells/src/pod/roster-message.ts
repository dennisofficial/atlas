import {
  EShellStatus,
  runningShellsReminder,
  type Assembled,
  type V2Event,
} from '@dltech/atlas-core'

import { shellsOfEvents } from '../core'
import { startedOf } from './status'

export const withRunningRoster = (args: {
  assembled: Assembled
  events: readonly V2Event[]
}): Assembled => {
  const last = args.events[args.events.length - 1]
  if (last === undefined) return args.assembled
  const running = shellsOfEvents(args.events).filter((row) => row.status === EShellStatus.Running)
  if (running.length === 0) return args.assembled
  const text = runningShellsReminder(
    running.map((row) => ({
      shellId: row.shellId,
      command: row.command,
      description: startedOf({ events: args.events, shellId: row.shellId })?.description,
      awaitingInput: false,
      totalCharacters: row.characters,
    })),
  )
  return {
    ...args.assembled,
    messages: [
      ...args.assembled.messages,
      {
        message: { role: 'user', content: [{ type: 'text', text }] },
        origin: { eventId: last.id, seq: last.seq },
        volatile: true,
      },
    ],
  }
}
