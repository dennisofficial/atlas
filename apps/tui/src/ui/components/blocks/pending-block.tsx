import React from 'react'

import { EEntryKind, EPendingKind, type PendingRow } from '../../../store'
import { NoticeBlock } from './notice-block'
import { UserBlock } from './user-block'

const SHELL_OUTPUT_HINT = '↵ output'

const PRINTED_NOTHING = 'printed nothing'

const MATCHED_LINES_HINT = '↵ matches'

const MATCHED_NOTHING = 'matched nothing'

const AGENT_REPORT_HINT = '↵ report'

const REPORTED_NOTHING = 'reported nothing'

type PendingNoticeRun = {
  kind: EPendingKind.BackgroundShell | EPendingKind.Agent | EPendingKind.Service
  id: string
  text: string
  failed: boolean
  body: string | null
  entryKind: EEntryKind
}

type PendingRun =
  | { kind: EPendingKind.Sending; id: string; text: string; failed: boolean }
  | { kind: EPendingKind.Operator; id: string; said: readonly string[]; editable?: boolean | undefined }
  | PendingNoticeRun

export function pendingRuns(rows: readonly PendingRow[]): readonly PendingRun[] {
  const runs: PendingRun[] = []

  for (const row of rows) {
    if (row.kind === EPendingKind.Sending) {
      runs.push({ kind: EPendingKind.Sending, id: row.id, text: row.text, failed: row.failed })
      continue
    }

    if (row.kind === EPendingKind.Operator || row.kind === EPendingKind.Command) {
      const open = runs.at(-1)
      const editable = row.kind === EPendingKind.Command || row.editable !== false
      if (open?.kind === EPendingKind.Operator && (open.editable !== false) === editable) {
        open.said = [...open.said, row.text]
        continue
      }

      runs.push({ kind: EPendingKind.Operator, id: row.id, said: [row.text], ...(editable ? {} : { editable: false }) })
      continue
    }

    runs.push({
      kind: row.kind,
      id: row.id,
      text: row.text,
      failed: row.failed,
      body: row.body,
      entryKind: row.entryKind,
    })
  }

  return runs
}

function noticeProps(run: PendingNoticeRun): {
  openHint: string
  silentNote?: string
} {
  if (run.entryKind === EEntryKind.AgentEnded && run.body !== null && run.body.trim() !== '') {
    return { openHint: AGENT_REPORT_HINT }
  }

  switch (run.entryKind) {
    case EEntryKind.BackgroundShellAwaitingInput:
      return { openHint: SHELL_OUTPUT_HINT, silentNote: PRINTED_NOTHING }
    case EEntryKind.BackgroundShellMatched:
      return { openHint: MATCHED_LINES_HINT, silentNote: MATCHED_NOTHING }
    case EEntryKind.BackgroundShellStillRunning:
    case EEntryKind.BackgroundShellEnded:
    case EEntryKind.ServiceEnded:
      return { openHint: SHELL_OUTPUT_HINT, silentNote: PRINTED_NOTHING }
    case EEntryKind.AgentEnded:
      return { openHint: AGENT_REPORT_HINT, silentNote: REPORTED_NOTHING }
    default:
      return { openHint: SHELL_OUTPUT_HINT }
  }
}

export function PendingBlock(props: {
  rows: readonly PendingRow[]
  width: number
}): React.ReactNode {
  if (props.rows.length === 0) return null

  return (
    <box flexDirection="column" flexShrink={0}>
      {pendingRuns(props.rows).map((run) => {
        if (run.kind === EPendingKind.Sending) {
          return (
            <UserBlock
              key={run.id}
              said={[run.text]}
              width={props.width}
              sending={!run.failed}
              sendFailed={run.failed}
            />
          )
        }
        if (run.kind === EPendingKind.Operator) {
          return <UserBlock key={run.id} said={run.said} width={props.width} takeBack={run.editable !== false} />
        }
        return (
          <NoticeBlock
            key={run.id}
            text={run.text}
            body={run.body}
            failed={run.failed}
            width={props.width}
            pending
            {...noticeProps(run)}
          />
        )
      })}
    </box>
  )
}
