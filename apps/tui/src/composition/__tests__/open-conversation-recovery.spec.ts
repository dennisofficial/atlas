import {
  EShellStatus,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  toShellId,
  type ShellRegistryPort,
  type ShellSnapshot,
} from '@dltech/atlas-harness'

import { EOpenMode } from '../config'
import { openConversation, type OpenOutcome, type OpenedConversation } from '../open-conversation'
import { fakeAgentRegistry } from './fake-agents'
import {
  fakeEventLog,
  fakeIds,
  fakeLedger,
  fakeThreadStore,
  FAKE_WORKSPACE,
  SPEC_SHARD,
} from './fake-backend'

const YESTERDAY = toThreadId(`yesterday-${SPEC_SHARD}`)
const HERE = { workspace: FAKE_WORKSPACE, repo: null }

const opened = (outcome: OpenOutcome): OpenedConversation => {
  if ('cloud' in outcome || !outcome.ok) {
    throw new Error(`expected an opened conversation, got: ${'cloud' in outcome ? 'cloud' : outcome.reason}`)
  }
  return outcome.conversation
}

const said = (text: string): Event => ({
  type: 'user-said',
  text,
  id: toEventId('e1'),
  seq: 1,
  threadId: YESTERDAY,
  runId: toRunId('r1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
})

const shellStarted = (args: {
  shellId: string
  command: string
  seq: number
  bootId?: string | undefined
}): Event => ({
  type: 'background-shell-started',
  shellId: args.shellId,
  command: args.command,
  bootId: args.bootId,
  id: toEventId(`start-${args.seq}`),
  seq: args.seq,
  threadId: YESTERDAY,
  runId: toRunId('r1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
})

const liveShell = (args: {
  shellId: string
  threadId?: Parameters<typeof toThreadId>[0]
  ended?: boolean
}): ShellSnapshot => ({
  shellId: toShellId(args.shellId),
  threadId: toThreadId(args.threadId ?? YESTERDAY),
  command: 'bun run build',
  description: '',
  status: args.ended === true ? EShellStatus.Exited : EShellStatus.Running,
  startedAt: '2026-08-24T00:00:00.000Z',
  lastOutputAt: '2026-08-24T00:00:00.000Z',
  endedAt: args.ended === true ? '2026-08-24T00:01:00.000Z' : undefined,
  totalCharacters: 0,
  awaitingInput: false,
})

const shellsHolding = (snapshots: readonly ShellSnapshot[]): ShellRegistryPort => {
  const listed = [...snapshots]
  return {
    listEverywhere: () => listed,
  } as unknown as ShellRegistryPort
}

describe('first reopen does not settle shells this process still owns', () => {
  it('leaves this boot’s undated-looking open start alone while the live registry holds the shell', async () => {
    const log = fakeEventLog([
      said('is my build still running'),
      shellStarted({ shellId: 'bash_1', command: 'bun run build', seq: 2 }),
    ])

    const outcome = await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY] }),
      log,
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      shells: shellsHolding([liveShell({ shellId: 'bash_1' })]),
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).lostShells).toEqual([])
    expect(
      log.peek({ threadId: YESTERDAY }).filter((event) => event.type === 'background-shell-ended'),
    ).toHaveLength(0)
  })

  it('still settles the shell once nothing live vouches for it', async () => {
    const log = fakeEventLog([
      said('is my build still running'),
      shellStarted({ shellId: 'bash_1', command: 'bun run build', seq: 2 }),
    ])

    const outcome = await openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY] }),
      log,
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      shells: shellsHolding([liveShell({ shellId: 'bash_1', ended: true })]),
      open: { mode: EOpenMode.Continue },
    })

    expect(opened(outcome).lostShells).toEqual([
      { shellId: 'bash_1', command: 'bun run build', description: undefined },
    ])
    const written = log
      .peek({ threadId: YESTERDAY })
      .filter((event) => event.type === 'background-shell-ended')
    expect(written).toHaveLength(1)
    const ending = written[0]
    if (ending?.type !== 'background-shell-ended') throw new Error('expected a synthetic ending')
    expect(ending.killedBy).toBe(EKilledBy.Unrecorded)
  })
})
