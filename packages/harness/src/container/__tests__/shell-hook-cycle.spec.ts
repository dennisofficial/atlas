import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'

import {
  AfterShellHook,
  ClockPort,
  EStage,
  EventLogPort,
  IdPort,
  ProcessPort,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type EndedShell,
  type EventDraft,
  type HookOrder,
  type HookOutcome,
  type ThreadId,
} from '@dltech/atlas-core'

import { LocalProcessPort } from '../../execution/local-process'
import { resolveHookChain } from '../../hooks/resolve-hooks'
import { registerShells } from '../../shells/register-shells'
import { ShellRegistryPort } from '../../shells/shell-registry'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { registryFor } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import {
  createIsolatedContainer,
  instanceCachingFactory,
  portToken,
  type DependencyContainer,
} from '../injection'
import { AtlasHomeToken, HookChainToken, SessionRegistryToken, WorkspaceRoot } from '../tokens'

class FixedClock extends ClockPort {
  now(): string {
    return '2026-08-27T12:00:00.000Z'
  }
}

const THREAD = toThreadId('thread-under-test')

const fired: EndedShell[] = []

/**
 * The cycle, in one class: a hook that reaches back into the registry that fires it. Resolving
 * either end eagerly would recurse, so the registry holds the chain as a thunk.
 */
class ListingAfterShellHook extends AfterShellHook {
  readonly name = 'list-shells-when-one-ends'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 0 }

  constructor(private readonly shells: ShellRegistryPort) {
    super()
  }

  readonly run = async ({ shell }: { shell: EndedShell }): Promise<HookOutcome> => {
    fired.push(shell)
    return { additionalContext: `${this.shells.listEverywhere().length} shells are known` }
  }
}

const opened: { container: DependencyContainer; root: string; home: string }[] = []

afterEach(async () => {
  fired.splice(0)
  for (const entry of opened.splice(0)) {
    await entry.container.resolve(portToken(ShellRegistryPort)).closeAll()
    rmSync(entry.root, { recursive: true, force: true })
    rmSync(entry.home, { recursive: true, force: true })
  }
})

async function openContainer(): Promise<{
  container: DependencyContainer
  root: string
  appended: { threadId: ThreadId; drafts: readonly EventDraft[] }[]
}> {
  const root = mkdtempSync(join(tmpdir(), 'atlas-shell-cycle-'))
  const home = mkdtempSync(join(tmpdir(), 'atlas-shell-cycle-home-'))
  const container = createIsolatedContainer()
  container.register(WorkspaceRoot, { useValue: root })
  container.register(portToken(AfterShellHook), {
    useFactory: (resolver) =>
      new ListingAfterShellHook(resolver.resolve(portToken(ShellRegistryPort))),
  })
  container.register(portToken(ClockPort), { useClass: FixedClock })
  container.register(AtlasHomeToken, { useValue: home })
  container.register(SessionRegistryToken, { useValue: registryFor({ home }) })
  container.register(portToken(ProcessPort), { useValue: new LocalProcessPort() })

  const appended: { threadId: ThreadId; drafts: readonly EventDraft[] }[] = []
  class RecordingLog extends EventLogPort {
    async append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }) {
      appended.push(args)
      return []
    }
    async replace() {
      return []
    }
    async read() {
      return []
    }
    async refresh() {}
    async head() {
      return 0
    }
    async readOwn() {
      return []
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
  container.register(portToken(EventLogPort), { useClass: RecordingLog })
  container.register(portToken(IdPort), { useClass: StubIds })

  await new JsonlThreadStore(
    home,
    registryFor({ home }),
    container.resolve(portToken(ClockPort)),
    container.resolve(portToken(IdPort)),
    new JsonlEventLog(
      home,
      registryFor({ home }),
      container.resolve(portToken(ClockPort)),
      container.resolve(portToken(IdPort)),
    ),
  ).create({ id: THREAD })

  registerShells({ container })
  container.register(HookChainToken, {
    useFactory: instanceCachingFactory((resolver) => resolveHookChain({ container: resolver })),
  })

  const entry = { container, root, home, appended }
  opened.push(entry)
  return entry
}

describe('the shell registry and the hook chain, in a real container', () => {
  it('resolves both ends of the cycle without recursing', async () => {
    const { container } = await openContainer()

    const shells = container.resolve(portToken(ShellRegistryPort))
    const chain = container.resolve(HookChainToken)

    expect(shells).toBe(container.resolve(portToken(ShellRegistryPort)))
    expect(chain).toBe(container.resolve(HookChainToken))
  })

  it('reaches a hook that depends on the registry firing it', async () => {
    const { container, appended } = await openContainer()
    const shells = container.resolve(portToken(ShellRegistryPort))

    const started = await shells.start({
      threadId: THREAD,
      command: 'echo wired',
      description: 'Prove the wiring',
    })
    if (!started.ok) throw new Error(started.reason)

    const ended = () =>
      appended.some((call) => call.drafts.some((draft) => draft.type === 'background-shell-ended'))
    for (let attempt = 0; attempt < 200 && !ended(); attempt += 1) {
      await Bun.sleep(25)
    }

    expect(fired.map((shell) => shell.command)).toEqual(['echo wired'])
    const drafts = appended.flatMap((call) => call.drafts)
    expect(drafts.map((draft) => draft.type)).toEqual([
      'background-shell-started',
      'background-shell-ended',
      'context-loaded',
    ])
    expect(shells.drainNotifications({ threadId: THREAD })).toEqual([])
  })
})
