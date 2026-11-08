import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

const RUNNING_LABELS: Readonly<Record<string, string>> = {
  rewind: 'Rewinding…',
  summarise: 'Summarising…',
  rename: 'Renaming…',
}

const titleCased = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`

export const commandRowLabelOf = (row: Pick<SessionCommandRow, 'name' | 'state'>): string =>
  row.state === ECommandState.Queued
    ? `Queued: ${titleCased(row.name)}`
    : (RUNNING_LABELS[row.name] ?? `Running ${row.name}…`)
