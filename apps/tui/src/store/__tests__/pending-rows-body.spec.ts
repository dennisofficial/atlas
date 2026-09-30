import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EServiceStatus, EShellStatus, toThreadId } from '@dltech/atlas-core'
import {
  ENotice,
  toShellId,
  type AgentSnapshot,
  type PendingShellNotice,
  type ServiceSnapshot,
  type ShellSnapshot,
} from '@dltech/atlas-harness'

import { EPendingKind, pendingRows } from '../pending-rows'
import { EEntryKind } from '../transcript-model'

const service = (over: Partial<ServiceSnapshot> = {}): ServiceSnapshot => ({
  serviceId: 'svc_1',
  command: 'bun run dev',
  description: 'web dev server',
  status: EServiceStatus.Exited,
  exitCode: 0,
  pid: 4_242,
  logPath: '/tmp/atlas/services/svc_1.log',
  startedAt: '2026-08-27T12:00:00.000Z',
  endedAt: '2026-08-27T12:01:00.000Z',
  ...over,
})

const snapshot = (over: Partial<ShellSnapshot> = {}): ShellSnapshot =>
  ({
    shellId: toShellId('bash_1'),
    command: 'bun test',
    description: 'Run full TUI suite',
    status: EShellStatus.Exited,
    exitCode: 0,
    pid: 4_242,
    startedAt: '2026-08-27T12:00:00.000Z',
    lastOutputAt: '2026-08-27T12:00:01.000Z',
    totalCharacters: 18,
    awaitingInput: false,
    ...over,
  }) as ShellSnapshot

const notice = (
  over: Partial<ShellSnapshot> = {},
  kind: ENotice = ENotice.Ended,
): PendingShellNotice => ({ kind, snapshot: snapshot(over) })

const child = (over: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  agentId: toThreadId('thread-child'),
  spawnedBy: toThreadId('thread-parent'),
  agentType: 'explore',
  intent: 'audit the credential vault',
  status: EAgentStatus.Finished,
  turns: 3,
  toolCalls: 12,
  lastTool: 'grep',
  startedAt: '2026-08-27T12:00:00.000Z',
  endedAt: '2026-08-27T12:04:00.000Z',
  ...over,
})

describe('what a waiting notice knows about its body', () => {
  it('carries an awaiting-input shell as the entry kind the transcript lands, so the block can read it the same', () => {
    const rows = pendingRows({
      entries: [],
      notices: [notice({ status: EShellStatus.Running, awaitingInput: true })],
      agents: [],
      services: [],
    })

    expect(rows[0]).toEqual({
      kind: EPendingKind.BackgroundShell,
      id: 'shell-awaiting-bash_1',
      text: 'Background shell "Run full TUI suite" is waiting on input and cannot be answered',
      failed: true,
      body: null,
      entryKind: EEntryKind.BackgroundShellAwaitingInput,
    })
  })

  it('claims nothing about a body the registry has not handed over, so no notice reads as empty', () => {
    const rows = pendingRows({
      entries: [],
      notices: [notice()],
      agents: [child()],
      services: [service()],
    })

    const bodies = rows.flatMap((row) =>
      row.kind === EPendingKind.BackgroundShell ||
      row.kind === EPendingKind.Agent ||
      row.kind === EPendingKind.Service
        ? [row.body]
        : [],
    )

    expect(bodies).toEqual([null, null, null])
  })
})
