import { toEventId, toRunId, toThreadId, type Event, type ThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { LostShell, ShellRegistryPort } from '@dltech/atlas-harness'

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

const LOST = [{ shellId: 'bash_1', command: 'bun run build', description: undefined }]

const reconcilingShells = (lost: readonly LostShell[]): { shells: ShellRegistryPort; asked: ThreadId[] } => {
  const asked: ThreadId[] = []
  const shells = {
    reconcile: async ({ threadId }: { threadId: ThreadId }) => {
      asked.push(threadId)
      return lost
    },
  } as unknown as ShellRegistryPort
  return { shells, asked }
}

describe('reopening a conversation hands its shells to the registry to reconcile', () => {
  const reopen = (shells: ShellRegistryPort) =>
    openConversation({
      threads: fakeThreadStore({ existing: [YESTERDAY] }),
      log: fakeEventLog([said('is my build still running')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      shells,
      open: { mode: EOpenMode.Continue },
    })

  it('asks the registry about the reopened thread and reports what it lost', async () => {
    const { shells, asked } = reconcilingShells(LOST)

    expect(opened(await reopen(shells)).lostShells).toEqual(LOST)
    expect(asked).toEqual([YESTERDAY])
  })

  it('reports nothing when the registry lost nothing', async () => {
    const { shells } = reconcilingShells([])

    expect(opened(await reopen(shells)).lostShells).toEqual([])
  })
})
