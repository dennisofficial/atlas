import { afterEach, describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EShellStatus,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
  type RewindCut,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ShellSnapshot } from '../../shells/background-shell'
import { toShellId } from '../../shells/shell-id'
import { LocalRewindMachinery } from '../local-rewind-machinery'
import { rewindThread } from '../rewind'
import { openStoreFixture, UnstaffedShells, type StoreFixture } from './harness'

let fixture: StoreFixture

const runId = toRunId('run-1')
const said = (text: string): EventDraft => ({ type: 'user-said', text })

const startedInBackground: EventDraft = {
  type: 'tool-called',
  callId: toCallId('call-bg'),
  name: 'bash',
  input: { command: 'npm test', runInBackground: true },
  ordinal: 0,
}

const backgrounded: EventDraft = {
  type: 'tool-result',
  callId: toCallId('call-bg'),
  name: 'bash',
  output: { shellId: 'bash_1', status: 'running' },
}

class RecordingShells extends UnstaffedShells {
  readonly snapshot: ShellSnapshot = {
    shellId: toShellId('bash_1'),
    threadId: toThreadId('thr-placeholder'),
    command: 'npm test',
    description: 'Run a background job',
    status: EShellStatus.Running,
    startedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    lastOutputAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    totalCharacters: 0,
    awaitingInput: false,
  }
  readonly removed: { shellId: string; by: EKilledBy }[] = []

  override list(): readonly ShellSnapshot[] {
    return [this.snapshot]
  }

  override removeShells(args: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): void {
    for (const shellId of args.shellIds) this.removed.push({ shellId, by: args.by })
  }
}

afterEach(async () => {
  await fixture.close()
})

describe('LocalRewindMachinery', () => {
  it('drives rewindThread end to end: prices the cut from the registry and removes on confirm', async () => {
    fixture = openStoreFixture()
    const shells = new RecordingShells()
    const machinery = new LocalRewindMachinery({
      agents: fixture.agents,
      shells,
      services: fixture.services,
    })
    const thread = await fixture.threads.create({ title: 'machinery' })
    await fixture.log.append({
      threadId: thread.id,
      runId,
      drafts: [said('msg_1'), startedInBackground, backgrounded, said('msg_2')],
    })

    const asking = await rewindThread({
      log: fixture.log,
      threads: fixture.threads,
      machinery,
      threadId: thread.id,
      toSeq: 1,
    })

    expect(asking).toEqual({
      ok: false,
      needsConfirmation: true,
      toSeq: 1,
      reachable: true,
      kills: [
        {
          kind: 'shell',
          shellId: 'bash_1',
          command: 'npm test',
          description: 'Run a background job',
          running: true,
        },
      ],
    })
    expect(shells.removed).toEqual([])

    const confirmed = await rewindThread({
      log: fixture.log,
      threads: fixture.threads,
      machinery,
      threadId: thread.id,
      toSeq: 1,
      confirmed: true,
    })

    expect(confirmed).toMatchObject({ ok: true, discarded: 3 })
    expect((await fixture.log.read({ threadId: thread.id })).map((event) => event.type)).toEqual([
      'user-said',
    ])
    expect(shells.removed).toEqual([{ shellId: 'bash_1', by: EKilledBy.Rewind }])
  })

  it('answers an empty read without touching the registries', async () => {
    const machinery = new LocalRewindMachinery({
      agents: fixture?.agents ?? ({} as never),
      shells: new UnstaffedShells(),
      services: fixture?.services ?? ({} as never),
    })

    const read = await machinery.snapshot({
      cuts: [],
      threadId: toThreadId('thr-none'),
    })

    expect(read).toEqual({ reachable: true, kills: [] })
  })

  it('destroys nothing for an empty cut list', async () => {
    const shells = new RecordingShells()
    fixture = openStoreFixture()
    const machinery = new LocalRewindMachinery({
      agents: fixture.agents,
      shells,
      services: fixture.services,
    })

    await machinery.destroy({ cuts: emptyCuts(), threadId: toThreadId('thr-none') })

    expect(shells.removed).toEqual([])
  })
})

const emptyCuts = (): readonly RewindCut[] => []
