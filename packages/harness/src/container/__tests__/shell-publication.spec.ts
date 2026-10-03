import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'

import {
  ClockPort,
  EventLogPort,
  IdPort,
  LogPort,
  ProcessPort,
  toThreadId,
  type LogEntry,
  type ThreadId,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { recorder } from '../../channel/__tests__/signals'
import { LocalProcessPort } from '../../execution/local-process'
import { HookChain } from '../../hooks/registry'
import { registerShells } from '../../shells/register-shells'
import { ShellRegistryPort } from '../../shells/shell-registry'
import { RandomIds, SystemClock } from '../../store'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { registryFor } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import {
  createIsolatedContainer,
  portToken,
  type DependencyContainer,
} from '../injection'
import {
  AtlasHomeToken,
  DeltaChannelToken,
  HookChainToken,
  SessionRegistryToken,
  WorkspaceRoot,
} from '../tokens'

const THREAD = toThreadId('thread-with-shell')
const OTHER = toThreadId('thread-elsewhere')

const opened: { container: DependencyContainer; dirs: string[] }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    if (entry.container.isRegistered(portToken(ShellRegistryPort), true)) {
      await entry.container.resolve(portToken(ShellRegistryPort)).closeAll()
    }
    for (const dir of entry.dirs) rmSync(dir, { recursive: true, force: true })
  }
})

async function openHarness(args: { withChannel: boolean; operational?: LogPort }): Promise<{
  shells: ShellRegistryPort
  log: EventLogPort
  seen: ReturnType<typeof recorder>['seen']
  channel: ReturnType<typeof createDeltaChannel> | undefined
}> {
  const home = mkdtempSync(join(tmpdir(), 'atlas-shell-publication-store-'))
  const root = mkdtempSync(join(tmpdir(), 'atlas-shell-publication-root-'))

  const container = createIsolatedContainer()
  container.register(WorkspaceRoot, { useValue: root })
  container.register(portToken(ClockPort), { useClass: SystemClock })
  container.register(portToken(IdPort), { useClass: RandomIds })
  if (args.operational !== undefined) {
    container.register(portToken(LogPort), { useValue: args.operational })
  }
  container.register(AtlasHomeToken, { useValue: home })
  container.register(SessionRegistryToken, { useValue: registryFor({ home }) })
  container.register(portToken(ProcessPort), { useValue: new LocalProcessPort() })
  container.register(portToken(EventLogPort), {
    useFactory: (resolver) =>
      new JsonlEventLog(
        home,
        registryFor({ home }),
        resolver.resolve(portToken(ClockPort)),
        resolver.resolve(portToken(IdPort)),
      ),
  })

  registerShells({ container })
  container.register(HookChainToken, { useValue: new HookChain({}) })

  const shells = container.resolve(portToken(ShellRegistryPort))

  const { seen, listener } = recorder()
  let channel: ReturnType<typeof createDeltaChannel> | undefined
  if (args.withChannel) {
    channel = createDeltaChannel()
    container.register(DeltaChannelToken, { useValue: channel })
    channel.subscribe({ threadId: THREAD, listener })
  }

  const log = container.resolve(portToken(EventLogPort))
  await new JsonlThreadStore(
    home,
    registryFor({ home }),
    container.resolve(portToken(ClockPort)),
    container.resolve(portToken(IdPort)),
    log,
  ).create({ id: THREAD })
  opened.push({ container, dirs: [home, root] })
  return { shells, log, seen, channel }
}

const untilDurable = async (args: { log: EventLogPort }): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const events = await args.log.readOwn({ threadId: THREAD })
    if (events.some((event) => event.type === 'background-shell-ended')) return
    await Bun.sleep(25)
  }
}

describe('a background shell ending while its thread is idle', () => {
  it('appends the ending durably and publishes events-appended to the owning thread', async () => {
    const { shells, log, seen } = await openHarness({ withChannel: true })

    const started = await shells.start({
      threadId: THREAD,
      command: 'echo publication',
      description: 'Prove publication',
    })
    if (!started.ok) throw new Error(started.reason)

    expect(started.snapshot.shellId).toMatch(/^shell_[0-9a-f]{32}$/)
    const startedEvents = await log.readOwn({ threadId: THREAD })
    expect(startedEvents.map((event) => event.type)).toEqual(['background-shell-started'])
    expect(seen).toEqual([{ type: 'events-appended' }])

    await untilDurable({ log })

    const events = await log.readOwn({ threadId: THREAD })
    const endings = events.filter((event) => event.type === 'background-shell-ended')
    expect(endings).toHaveLength(1)
    expect(endings[0]?.seq).toBeGreaterThan(0)
    expect(endings[0]).toMatchObject({ shellId: started.snapshot.shellId })
    expect(seen).toEqual([{ type: 'events-appended' }, { type: 'events-appended' }])
  })

  it('publishes nothing to a thread the ending does not belong to', async () => {
    const { shells, log, channel } = await openHarness({ withChannel: true })
    if (channel === undefined) throw new Error('expected a registered channel')

    const other = recorder()
    channel.subscribe({ threadId: OTHER, listener: other.listener })

    const started = await shells.start({
      threadId: THREAD,
      command: 'echo isolated',
      description: 'Prove isolation',
    })
    if (!started.ok) throw new Error(started.reason)

    await untilDurable({ log })

    expect(other.seen).toEqual([])
    expect(channel.snapshot({ threadId: OTHER })).toEqual([])
  })

  it('keeps the durable append and notifies the healthy subscriber when another listener throws', async () => {
    const entries: LogEntry[] = []
    class RecordingOperationalLog extends LogPort {
      record(entry: LogEntry): void {
        entries.push(entry)
      }
    }
    const { shells, log, seen, channel } = await openHarness({
      withChannel: true,
      operational: new RecordingOperationalLog(),
    })
    channel?.subscribe({
      threadId: THREAD,
      listener: () => {
        throw new Error('listener exploded')
      },
    })

    const started = await shells.start({
      threadId: THREAD,
      command: 'echo resilient',
      description: 'Prove listener isolation',
    })
    if (!started.ok) throw new Error(started.reason)

    await untilDurable({ log })

    const events = await log.readOwn({ threadId: THREAD })
    expect(events.some((event) => event.type === 'background-shell-ended')).toBe(true)
    expect(seen).toEqual([{ type: 'events-appended' }, { type: 'events-appended' }])
    expect(
      entries.some(
        (entry) => entry.source === 'shells.publication' && entry.error === 'listener exploded',
      ),
    ).toBe(true)
  })

  it('still records the ending durably when no channel is registered', async () => {
    const { shells, log, seen } = await openHarness({ withChannel: false })

    const started = await shells.start({
      threadId: THREAD,
      command: 'echo channelless',
      description: 'Prove channel-less endings still land',
    })
    if (!started.ok) throw new Error(started.reason)

    await untilDurable({ log })

    const events = await log.readOwn({ threadId: THREAD })
    expect(events.some((event) => event.type === 'background-shell-ended')).toBe(true)
    expect(seen).toEqual([])
  })
})
