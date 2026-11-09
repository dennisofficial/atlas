import { pluginViewOf } from '@dltech/atlas-client/stream'
import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { EShellStatus } from '@dltech/atlas-core'

import { SHELLS_VIEW, shellsViewSchema, type ShellRow } from '../core'

export { shellsCoreSlots } from '../core'

export const shellsClient: ClientSlot = {
  hooks: [
    {
      name: 'shells-roster',
      appliesTo: (event) => event.type.startsWith('background-shell-'),
    },
  ],
}

export type ShellRosterRow = { shellId: string; name: string }

export type ShellRoster = {
  running: number
  awaitingInput: boolean
  labels: readonly string[]
  rows: readonly ShellRosterRow[]
}

export const shellsOfView = (views: Readonly<Record<string, unknown>>): readonly ShellRow[] =>
  pluginViewOf({
    views,
    name: SHELLS_VIEW,
    schema: shellsViewSchema,
  }) ?? []

export const shellRosterOf = (views: Readonly<Record<string, unknown>>): ShellRoster => {
  const running = shellsOfView(views).filter((row) => row.status === EShellStatus.Running)
  return {
    running: running.length,
    awaitingInput: running.some((row) => row.awaitingInput),
    labels: running.map((row) => row.name),
    rows: running.map((row) => ({ shellId: row.shellId, name: row.name })),
  }
}
