import { afterEach, describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  EShellStatus,
  toCallId,
  toRunId,
  type ThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import type { ServiceSnapshot } from '../../services/service-process'
import type { ShellSnapshot } from '../../shells/background-shell'
import { toShellId } from '../../shells/shell-id'
import { LocalRewindMachinery } from '../local-rewind-machinery'
import { rewindThread } from '../rewind'
import {
  openStoreFixture,
  UnstaffedServices,
  UnstaffedShells,
  type StoreFixture,
} from './harness'

let fixture: StoreFixture

const runId = toRunId('run-1')
const said = (text: string): EventDraft => ({ type: 'user-said', text })
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

afterEach(async () => {
  await fixture.close()
})

class ScriptedShells extends UnstaffedShells {
  private live: { threadId: ThreadId; snapshot: ShellSnapshot }[] = []
  readonly removed: { shellId: string; by: EKilledBy }[] = []

  place({ threadId, shellId, command }: { threadId: ThreadId; shellId: string; command: string }): void {
    const at = new Date(Date.UTC(2026, 0, 1)).toISOString()
    this.live.push({
      threadId,
      snapshot: {
        shellId: toShellId(shellId),
        threadId,
        command,
        description: 'Run a background job',
        status: EShellStatus.Running,
        startedAt: at,
        lastOutputAt: at,
        totalCharacters: 0,
        awaitingInput: false,
      },
    })
  }

  override list({ threadId }: { threadId: ThreadId }): readonly ShellSnapshot[] {
    return this.live.filter((entry) => entry.threadId === threadId).map((entry) => entry.snapshot)
  }

  override removeShells({
    threadId,
    shellIds,
    by,
  }: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): void {
    for (const shellId of shellIds) this.removed.push({ shellId, by })
    this.live = this.live.filter(
      (entry) => entry.threadId !== threadId || !shellIds.includes(entry.snapshot.shellId),
    )
  }
}

class ScriptedServices extends UnstaffedServices {
  private live: ServiceSnapshot[] = []
  readonly removed: { serviceId: string; by: EKilledBy }[] = []

  place({ serviceId, command }: { serviceId: string; command: string }): void {
    this.live.push({
      serviceId,
      command,
      description: 'dev server',
      status: EServiceStatus.Running,
      pid: 4242,
      logPath: '/tmp/svc.log',
      startedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    })
  }

  override list(): readonly ServiceSnapshot[] {
    return this.live
  }

  override removeServices({ serviceIds, by }: { serviceIds: readonly string[]; by: EKilledBy }): void {
    for (const serviceId of serviceIds) this.removed.push({ serviceId, by })
    this.live = this.live.filter((snapshot) => !serviceIds.includes(snapshot.serviceId))
  }
}

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

const shellEnded: EventDraft = {
  type: 'background-shell-ended',
  shellId: 'bash_1',
  command: 'npm test',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: 'all green',
  droppedCharacters: 0,
  remainingCharacters: 0,
}

const startedService: EventDraft = {
  type: 'tool-called',
  callId: toCallId('call-svc'),
  name: 'service_start',
  input: { command: 'npm run dev', description: 'dev server' },
  ordinal: 0,
}

const serviceRunning: EventDraft = {
  type: 'tool-result',
  callId: toCallId('call-svc'),
  name: 'service_start',
  output: { serviceId: 'svc_1', status: 'running' },
}

const serviceEnded: EventDraft = {
  type: 'service-ended',
  serviceId: 'svc_1',
  command: 'npm run dev',
  description: 'dev server',
  status: EServiceStatus.Exited,
  exitCode: 0,
  logPath: '/tmp/svc.log',
  tail: 'shutting down',
}

const openShellThread = async (): Promise<{ threadId: ThreadId; shells: ScriptedShells }> => {
  fixture = await openStoreFixture()
  const shells = new ScriptedShells()
  const thread = await fixture.threads.create({ title: 'shells' })
  await fixture.log.append({
    threadId: thread.id,
    runId,
    drafts: [said('msg_1'), startedInBackground, backgrounded, replied('on it'), said('msg_2'), shellEnded, said('msg_3')],
  })
  shells.place({ threadId: thread.id, shellId: 'bash_1', command: 'npm test' })
  return { threadId: thread.id, shells }
}

const rewind = (args: {
  threadId: ThreadId
  toSeq: number
  shells?: ScriptedShells
  services?: ScriptedServices
  confirmed?: boolean
}) =>
  rewindThread({
    log: fixture.log,
    threads: fixture.threads,
    machinery: new LocalRewindMachinery({
      agents: fixture.agents,
      shells: args.shells ?? fixture.shells,
      services: args.services ?? fixture.services,
    }),
    threadId: args.threadId,
    toSeq: args.toSeq,
    ...(args.confirmed === undefined ? {} : { confirmed: args.confirmed }),
  })

describe('rewindThread on a thread with a background shell', () => {
  it('keeps the ending that landed above the cut, re-appended above the new head, when the shell started below it', async () => {
    const { threadId, shells } = await openShellThread()

    const result = await rewind({ threadId, toSeq: 5, shells })

    expect(result).toEqual({ ok: true, discarded: 1, kills: [] })
    const events = await fixture.log.read({ threadId })
    expect(events.map((event) => event.type)).toEqual([
      'user-said',
      'tool-called',
      'tool-result',
      'assistant-said',
      'user-said',
      'background-shell-ended',
    ])
    expect(events.at(-1)?.seq).toBe(6)
    expect((await fixture.threads.find({ threadId }))?.head).toBe(6)
    expect(shells.removed).toEqual([])
  })

  it('asks before cutting below the shell’s start, naming the running shell, and writes nothing', async () => {
    const { threadId, shells } = await openShellThread()

    const result = await rewind({ threadId, toSeq: 1, shells })

    expect(result).toEqual({
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
    expect((await fixture.log.read({ threadId })).length).toBe(7)
    expect(shells.removed).toEqual([])
  })

  it('destroys the shell whole once confirmed', async () => {
    const { threadId, shells } = await openShellThread()

    const result = await rewind({ threadId, toSeq: 1, shells, confirmed: true })

    expect(result).toEqual({
      ok: true,
      discarded: 6,
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
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
    expect((await fixture.threads.find({ threadId }))?.head).toBe(1)
    expect(shells.removed).toEqual([{ shellId: 'bash_1', by: EKilledBy.Rewind }])
  })
})

describe('rewindThread on a thread with a service', () => {
  const openServiceThread = async (): Promise<{ threadId: ThreadId; services: ScriptedServices }> => {
    fixture = await openStoreFixture()
    const services = new ScriptedServices()
    const thread = await fixture.threads.create({ title: 'services' })
    await fixture.log.append({
      threadId: thread.id,
      runId,
      drafts: [said('msg_1'), startedService, serviceRunning, said('msg_2'), serviceEnded],
    })
    services.place({ serviceId: 'svc_1', command: 'npm run dev' })
    return { threadId: thread.id, services }
  }

  it('asks before cutting below the service start, and destroys it once confirmed', async () => {
    const { threadId, services } = await openServiceThread()

    const asking = await rewind({ threadId, toSeq: 1, services })
    expect(asking).toEqual({
      ok: false,
      needsConfirmation: true,
      toSeq: 1,
      reachable: true,
      kills: [
        {
          kind: 'service',
          serviceId: 'svc_1',
          command: 'npm run dev',
          description: 'dev server',
          running: true,
        },
      ],
    })
    expect(services.removed).toEqual([])

    const confirmed = await rewind({ threadId, toSeq: 1, services, confirmed: true })
    expect(confirmed).toMatchObject({ ok: true })
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
    expect(services.removed).toEqual([{ serviceId: 'svc_1', by: EKilledBy.Rewind }])
  })

  it('keeps the ending that landed above the cut when the service started below it', async () => {
    const { threadId, services } = await openServiceThread()

    const result = await rewind({ threadId, toSeq: 4, services })

    expect(result).toEqual({ ok: true, discarded: 0, kills: [] })
    const events = await fixture.log.read({ threadId })
    expect(events.map((event) => event.type)).toEqual([
      'user-said',
      'tool-called',
      'tool-result',
      'user-said',
      'service-ended',
    ])
    expect(services.removed).toEqual([])
  })
})
