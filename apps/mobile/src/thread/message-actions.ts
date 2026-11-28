import type { SummariseReach } from '@dltech/atlas-core'
import { eventIdOfEntryKey } from '@dltech/atlas-client/transcript'
import type { RewindKillRow } from '@dltech/atlas-client/session'

import { EMessageAuthor, type MessageRow } from './rows'

export enum EMessageAction {
  Copy = 'copy',
  Rewind = 'rewind',
  Summarise = 'summarise',
}

export type MessageActionHandlers = {
  rewindPoints: ReadonlySet<string>
  summarisePoints: ReadonlyMap<string, SummariseReach>
  onRewind: (row: MessageRow) => void
  onSummarise: (row: MessageRow) => void
}

export const REWIND_CONFIRM_TITLE = 'Rewind to this message?'

export const REWIND_CONFIRM_DESCRIPTION =
  'Rewinding stops everything started after this message. Files are left as they are.'

const KILL_KIND_LABEL: Record<RewindKillRow['kind'], string> = {
  agent: 'Agent',
  shell: 'Shell',
  service: 'Service',
}

const killLineOf = (kill: RewindKillRow): string =>
  `${KILL_KIND_LABEL[kill.kind]}: ${kill.label}${kill.running ? ' (running)' : ''}`

export const rewindConfirmOf = (
  kills: readonly RewindKillRow[],
): { title: string; message: string } => {
  const lines = kills.map(killLineOf)
  const body =
    lines.length === 0 ? [REWIND_CONFIRM_DESCRIPTION] : [REWIND_CONFIRM_DESCRIPTION, '', ...lines]
  return { title: REWIND_CONFIRM_TITLE, message: body.join('\n') }
}

export const messageActionLabelOf = (action: EMessageAction): string => {
  if (action === EMessageAction.Copy) return 'Copy'
  if (action === EMessageAction.Rewind) return 'Rewind to here'
  return 'Summarise up to here'
}

export const messageActionsOf = (args: {
  row: MessageRow
  queued: boolean
  rewindPoints: ReadonlySet<string> | undefined
  summarisePoints: ReadonlyMap<string, SummariseReach> | undefined
}): readonly EMessageAction[] => {
  const { row } = args
  if (args.queued || row.staged === true || row.command !== undefined) return []
  if (row.author === EMessageAuthor.Atlas) {
    return row.streaming ? [] : [EMessageAction.Copy]
  }
  if (row.text.trim().length === 0) return []
  const eventId = eventIdOfEntryKey(row.id)
  return [
    EMessageAction.Copy,
    ...(args.rewindPoints?.has(eventId) === true ? [EMessageAction.Rewind] : []),
    ...(args.summarisePoints?.has(eventId) === true ? [EMessageAction.Summarise] : []),
  ]
}
