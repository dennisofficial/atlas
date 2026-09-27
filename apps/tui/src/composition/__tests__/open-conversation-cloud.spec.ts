import { stat } from 'node:fs/promises'

import { describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  EventLogPort,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import {
  atlasDirectory,
  sessionDirectory,
  sessionLockFile,
  ThreadStorePort,
  type ThreadSummary,
} from '@dltech/atlas-harness'

import { EOpenMode } from '../config'
import { openConversation } from '../open-conversation'
import { fakeAgentRegistry } from './fake-agents'
import {
  fakeEventLog,
  fakeIds,
  fakeLedger,
  fakeThreadStore,
  FAKE_WORKSPACE,
  SPEC_SHARD,
} from './fake-backend'

const LIFTED = toThreadId(`lifted-${SPEC_SHARD}`)

const HERE: WorkspaceIdentity = { workspace: FAKE_WORKSPACE, repo: null }

const said = (text: string, threadId: ThreadId = LIFTED, seq = 1): Event => ({
  type: 'user-said',
  text,
  id: toEventId(`e-${threadId}-${seq}`),
  seq,
  threadId,
  runId: toRunId('r1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
})

const shellStarted = (args: { shellId: string; command: string; seq: number }): Event => ({
  type: 'background-shell-started',
  shellId: args.shellId,
  command: args.command,
  id: toEventId(`start-${args.seq}`),
  seq: args.seq,
  threadId: LIFTED,
  runId: toRunId('r1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
})

/**
 * The refusing halves of the real remote stores: reads answer, every mutation rejects. This is
 * what the sandbox's serve hands an attaching client — a fake that accepted writes would pass the
 * attach while production refused it.
 */
class RefusingThreadStore extends ThreadStorePort {
  constructor(private readonly row: ThreadSummary) {
    super()
  }

  override onRename() {
    return () => undefined
  }

  async find({ threadId }: { threadId: ThreadId }) {
    return threadId === this.row.id ? this.row : undefined
  }

  async spawned() {
    return []
  }

  async mostRecent() {
    return undefined
  }

  async list() {
    return []
  }

  async findNamed() {
    return undefined
  }

  private refuse(): Promise<never> {
    return Promise.reject(
      new Error('the sandbox owns the transcript while lifted — reads only over the channel'),
    )
  }

  create() { return this.refuse() }
  createWithFirstEvents() { return this.refuse() }
  rename() { return this.refuse() }
  chooseModel() { return this.refuse() }
  chooseExecutionLocation() { return this.refuse() }
  adopt() { return this.refuse() }
  rewind() { return this.refuse() }
  compact() { return this.refuse() }
  summarise() { return this.refuse() }
  fork() { return this.refuse() }
}

class RefusingEventLog extends EventLogPort {
  constructor(private readonly events: readonly Event[]) {
    super()
  }

  private refuse(): Promise<never> {
    return Promise.reject(
      new Error('the sandbox owns the transcript while lifted — reads only over the channel'),
    )
  }

  append() { return this.refuse() }
  replace() { return this.refuse() }

  async read({ threadId }: { threadId: ThreadId }) {
    return this.events.filter((event) => event.threadId === threadId)
  }

  async readOwn({ threadId }: { threadId: ThreadId }) {
    return this.events.filter((event) => event.threadId === threadId)
  }

  async head({ threadId }: { threadId: ThreadId }) {
    return this.events.filter((event) => event.threadId === threadId).at(-1)?.seq ?? 0
  }
}

const cloudRow = (workspace: string | null): ThreadSummary => ({
  id: LIFTED,
  head: 1,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  workspace,
  repo: null,
  executionLocation: EExecutionLocation.Cloud,
})

const openCloud = async (args: {
  threads: RefusingThreadStore
  log: RefusingEventLog
}) =>
  openConversation({
    threads: args.threads,
    log: args.log,
    ledger: fakeLedger(),
    agents: fakeAgentRegistry(),
    ids: fakeIds(),
    workspace: HERE,
    effects: () => undefined,
    open: { mode: EOpenMode.Resume, threadId: LIFTED, readOnly: true },
  })

describe('opening a cloud conversation through refusing stores', () => {
  it('opens a thread whose transcript carries no workspace attribution, without adopting it', async () => {
    const outcome = await openCloud({
      threads: new RefusingThreadStore(cloudRow(null)),
      log: new RefusingEventLog([said('said inside the sandbox')]),
    })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.conversation.threadId).toBe(LIFTED)
      expect(outcome.conversation.events).toHaveLength(1)
    }
  })

  it('claims no local lock for a transcript the sandbox owns', async () => {
    const outcome = await openCloud({
      threads: new RefusingThreadStore(cloudRow(FAKE_WORKSPACE)),
      log: new RefusingEventLog([said('said inside the sandbox')]),
    })

    expect(outcome.ok).toBe(true)
    const dir = sessionDirectory({ home: atlasDirectory(), sessionId: LIFTED })
    const locked = await stat(sessionLockFile({ sessionDir: dir })).then(
      () => true,
      () => false,
    )
    expect(locked).toBe(false)
  })

  it('does not settle lost shells into a transcript it cannot write', async () => {
    const log = new RefusingEventLog([
      said('is my build still running'),
      shellStarted({ shellId: 'bash_1', command: 'bun run build', seq: 2 }),
    ])

    const outcome = await openCloud({
      threads: new RefusingThreadStore(cloudRow(FAKE_WORKSPACE)),
      log,
    })

    expect(outcome.ok).toBe(true)
  })
})

describe('the default open keeps its local ownership behaviors', () => {
  it('still adopts an unattributed local thread', async () => {
    const threads = fakeThreadStore({ existing: [LIFTED], workspace: null })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('from before the attribution')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: LIFTED },
    })

    expect(outcome.ok).toBe(true)
    expect(threads.peekRow({ threadId: LIFTED })?.workspace).toBe(FAKE_WORKSPACE)
  })
})
