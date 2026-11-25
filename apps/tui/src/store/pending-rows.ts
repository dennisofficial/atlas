import { EMessageOrigin, EShellStatus, serviceFailed } from '@dltech/atlas-core'

import {
  agentEndedLine,
  agentEndingFailed,
  serviceEndedLine,
  shellAwaitingInputLine,
  shellEndedLine,
  shellEndingFailed,
  shellMatchedNoticeLine,
  EEntryKind,
} from '@dltech/atlas-client/transcript'
import type { ServiceRowView } from '../ui/services-model'
import type { ShellSnapshot } from '../ui/shells-model'
import type { AgentSnapshot } from './subagent-row'

export enum ENotice {
  Ended = 'ended',
  AwaitingInput = 'awaiting-input',
  Matched = 'matched',
}

export type PendingShellNotice = { kind: ENotice; snapshot: ShellSnapshot }

export type PendingEntry = {
  id: string
  text: string
  kind?: 'message' | 'command' | undefined
  via?: string | undefined
}

export enum EPendingKind {
  Operator = 'operator',
  Command = 'command',
  Sending = 'sending',
  BackgroundShell = 'background-shell',
  Agent = 'agent',
  Service = 'service',
}

type NoticePendingKind = EPendingKind.BackgroundShell | EPendingKind.Agent | EPendingKind.Service

export type PendingRow =
  | { kind: EPendingKind.Operator; id: string; text: string; editable?: boolean | undefined }
  | { kind: EPendingKind.Command; id: string; text: string }
  | { kind: EPendingKind.Sending; id: string; text: string; failed: boolean }
  | {
      kind: NoticePendingKind
      id: string
      text: string
      failed: boolean
      body: string | null
      entryKind: EEntryKind
    }

const NOTHING_PENDING: readonly PendingRow[] = Object.freeze([])

function pendingShellRow(notice: PendingShellNotice): PendingRow {
  const { snapshot } = notice

  if (notice.kind === ENotice.Matched) {
    return {
      kind: EPendingKind.BackgroundShell,
      id: `shell-matched-${snapshot.shellId}`,
      text: shellMatchedNoticeLine(snapshot),
      failed: false,
      body: null,
      entryKind: EEntryKind.BackgroundShellMatched,
    }
  }

  if (snapshot.status === EShellStatus.Running) {
    return {
      kind: EPendingKind.BackgroundShell,
      id: `shell-awaiting-${snapshot.shellId}`,
      text: shellAwaitingInputLine(snapshot),
      failed: false,
      body: null,
      entryKind: EEntryKind.BackgroundShellAwaitingInput,
    }
  }

  return {
    kind: EPendingKind.BackgroundShell,
    id: `shell-ended-${snapshot.shellId}`,
    text: shellEndedLine(snapshot),
    failed: shellEndingFailed(snapshot),
    body: null,
    entryKind: EEntryKind.BackgroundShellEnded,
  }
}

function pendingAgentRow(notice: AgentSnapshot): PendingRow {
  return {
    kind: EPendingKind.Agent,
    id: `agent-${notice.status}-${notice.agentId}`,
    text: agentEndedLine(notice),
    failed: agentEndingFailed(notice),
    body: null,
    entryKind: EEntryKind.AgentEnded,
  }
}

function pendingServiceRow(notice: ServiceRowView): PendingRow {
  return {
    kind: EPendingKind.Service,
    id: `service-${notice.status}-${notice.serviceId}`,
    text: serviceEndedLine(notice),
    failed: serviceFailed(notice),
    body: null,
    entryKind: EEntryKind.ServiceEnded,
  }
}

const operatorRows = (entries: readonly PendingEntry[]): readonly PendingRow[] =>
  entries.map((entry): PendingRow => {
    if (entry.kind === 'command') {
      return { kind: EPendingKind.Command, id: entry.id, text: entry.text }
    }

    return {
      kind: EPendingKind.Operator,
      id: entry.id,
      text: entry.text,
      ...(entry.via !== undefined && entry.via !== EMessageOrigin.Operator
        ? { editable: false }
        : {}),
    }
  })

export type RemotePendingEntry = {
  id: string
  text: string
  via?: string | undefined
  reserved: boolean
}

/**
 * The sandbox's queue, broadcast over the wire: reserved entries are already claimed by the
 * turn's intake, so they render without the take-back affordance — pressing ↑ can no longer
 * reach them. An entry whose text a live "sending…" placeholder already covers is suppressed —
 * the placeholder and the queue row are two projections of the same steer, and the placeholder
 * renders first (it needs no round trip), so it is the one that stays.
 */
const remoteOperatorRows = (
  entries: readonly RemotePendingEntry[],
  sendingTexts: ReadonlySet<string>,
): readonly PendingRow[] =>
  entries
    .filter((entry) => !entry.reserved && !sendingTexts.has(entry.text))
    .map(
      (entry): PendingRow => ({
        kind: EPendingKind.Operator,
        id: entry.id,
        text: entry.text,
        ...(entry.via !== undefined && entry.via !== EMessageOrigin.Operator
          ? { editable: false }
          : {}),
      }),
    )

export function pendingRows(args: {
  entries: readonly PendingEntry[]
  remoteEntries?: readonly RemotePendingEntry[] | undefined
  notices: readonly PendingShellNotice[]
  agents: readonly AgentSnapshot[]
  services: readonly ServiceRowView[]
  sending?: readonly { id: string; text: string; failed: boolean }[]
}): readonly PendingRow[] {
  const { agents, services } = args
  const sending = args.sending ?? []
  const sendingTexts = new Set(sending.filter((one) => !one.failed).map((one) => one.text))
  const operator =
    args.remoteEntries === undefined
      ? operatorRows(args.entries)
      : remoteOperatorRows(args.remoteEntries, sendingTexts)
  if (
    operator.length === 0 &&
    args.notices.length === 0 &&
    agents.length === 0 &&
    services.length === 0 &&
    sending.length === 0
  ) {
    return NOTHING_PENDING
  }

  return [
    ...sending.map(
      (one): PendingRow => ({
        kind: EPendingKind.Sending,
        id: one.id,
        text: one.text,
        failed: one.failed,
      }),
    ),
    ...operator,
    ...args.notices.map((notice): PendingRow => pendingShellRow(notice)),
    ...agents.map((notice): PendingRow => pendingAgentRow(notice)),
    ...services.map((notice): PendingRow => pendingServiceRow(notice)),
  ]
}
