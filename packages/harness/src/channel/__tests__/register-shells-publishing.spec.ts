import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'

import {
  ClockPort,
  EventLogPort,
  IdPort,
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { createIsolatedContainer, portToken, type DependencyContainer } from '../../container/injection'
import { DeltaChannelToken, HookChainToken, WorkspaceRoot } from '../../container/tokens'
import { HookChain } from '../../hooks/registry'
import { registerShells } from '../../shells/register-shells'
import { ShellRegistryPort } from '../../shells/shell-registry'
import { createDeltaChannel } from '../delta-channel'
import { recorder } from './signals'

const THREAD = toThreadId('thread-under-test')

class FixedClock extends ClockPort {
  now(): string {
    return '2026-08-27T12:00:00.000Z'
  }
}

class StubIds extends IdPort {
  nextThreadId(): ThreadId {
    return THREAD
  }
  nextRunId() {
    return toRunId('run-test')
  }
  nextEventId() {
    return toEventId('event-test')
  }
  nextCallId() {
    return toCallId('call-test')
  }
}

const opened: { container: DependencyContainer; root: string }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    if (entry.container.isRegistered(portToken(ShellRegistryPort), true)) {
      await entry.container.resolve(portToken(ShellRegistryPort)).closeAll()
    }
    rmSync(entry.root, { recursive: true, force: true })
  }
})

function fakeLog(): EventLogPort & { readonly appended: { threadId: ThreadId; drafts: readonly EventDraft[] }[] } {
  const appended: { threadId: ThreadId; drafts: readonly EventDraft[] }[] = []
  let seq = 0

  return {
    appended,

    async append({ threadId, runId, drafts }) {
      appended.push({ threadId, drafts })
      const envelopes = drafts.map(() => {
        seq += 1
        return {
          id: toEventId(`event-${seq}`),
          seq,
          threadId,
          runId,
          depth: 0,
          at: '2026-08-27T12:00:00.000Z',
        }
      })
      return stampDrafts({ drafts, envelopes })
    },

    async read() {
      return []
    },
    async refresh() {},
    async head() {
      return seq
    },
    async readOwn() {
      return []
    },
    async replace() {
      return []
    },
  }
}

function openContainer(): {
  container: DependencyContainer
  log: ReturnType<typeof fakeLog>
} {
  const root = mkdtempSync(join(tmpdir(), 'atlas-shell-publishing-'))
  const container = createIsolatedContainer()
  container.register(WorkspaceRoot, { useValue: root })
  container.register(portToken(ClockPort), { useClass: FixedClock })
  const log = fakeLog()
  container.register(portToken(EventLogPort), { useValue: log })
  container.register(portToken(IdPort), { useClass: StubIds })

  registerShells({ container })
  container.register(HookChainToken, { useValue: new HookChain({}) })

  opened.push({ container, root })
  return { container, log }
}

const untilAppended = async (log: ReturnType<typeof fakeLog>): Promise<void> => {
  for (let attempt = 0; attempt < 200 && log.appended.length === 0; attempt += 1) {
    await Bun.sleep(25)
  }
}

describe('registerShells with a channel resolved after the registry', () => {
  it('publishes events-appended to the owning thread when an idle shell ends', async () => {
    const { container, log } = openContainer()
    const shells = container.resolve(portToken(ShellRegistryPort))

    const channel = createDeltaChannel()
    container.register(DeltaChannelToken, { useValue: channel })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })

    const started = shells.start({
      threadId: THREAD,
      command: 'echo wired',
      description: 'Prove the wiring',
    })
    if (!started.ok) throw new Error(started.reason)

    await untilAppended(log)

    expect(log.appended.flatMap((call) => call.drafts.map((draft) => draft.type))).toEqual([
      'background-shell-ended',
    ])
    expect(seen).toEqual([{ type: 'events-appended' }])
  })
})
