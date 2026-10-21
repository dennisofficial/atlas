import { describe, expect, it } from 'vitest'

import {
  EAgentStart,
  ELogSeverity,
  EventLogPort,
  EShellStatus,
  LogPort,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type LogEntry,
  type ThreadId,
} from '@dltech/atlas-core'
import { MessageIntake, RandomIds } from '@dltech/atlas-harness'

import { teardownSession, type TeardownSource } from '../session-teardown'

const THREAD = toThreadId('thread-under-test')

const recordingSource = (args: {
  calls: string[]
  name: string
  drafts?: readonly EventDraft[]
  throws?: boolean
}): TeardownSource => ({
  closeAll: async () => {
    args.calls.push(`${args.name}:closeAll`)
    if (args.throws === true) throw new Error(`${args.name} would not close`)
  },
  threadsAwaitingNotice: () => (args.drafts === undefined ? [] : [THREAD]),
  drainNotifications: () => {
    args.calls.push(`${args.name}:drain`)
    return args.drafts ?? []
  },
})

const recordingLog = (calls: string[]): EventLogPort =>
  new (class extends EventLogPort {
    async append(): Promise<never[]> {
      calls.push('log:append')
      return []
    }

    async read(): Promise<never[]> {
      return []
    }

    async refresh(): Promise<void> {}

    async head(): Promise<number> {
      return 0
    }

    async readOwn(): Promise<never[]> {
      return []
    }

    async replace(): Promise<never[]> {
      return []
    }
  })()

describe('teardownSession', () => {
  const DRAFT: EventDraft = {
    type: 'background-shell-ended',
    shellId: 'bash_1',
    command: 'bun run dev',
    description: 'dev server',
    status: EShellStatus.Killed,
    exitCode: undefined,
    output: '...',
    droppedCharacters: 0,
    remainingCharacters: 0,
  }

  it('stops the sandbox only after the shells are closed and their endings appended', async () => {
    const calls: string[] = []
    const source = recordingSource({ calls, name: 'shells', drafts: [DRAFT] })

    await teardownSession({
      sources: [source],
      log: recordingLog(calls),
      ids: new RandomIds(),
      stopSandbox: async () => {
        calls.push('sandbox:stop')
      },
    })

    expect(calls).toEqual(['shells:closeAll', 'shells:drain', 'log:append', 'sandbox:stop'])
  })

  it('persists quiet bookkeeping even when no thread is awaiting a wake', async () => {
    const calls: string[] = []
    const quiet: TeardownSource = {
      ...recordingSource({ calls, name: 'agents' }),
      threadsAwaitingNotice: () => [],
      threadsWithPendingInput: () => [THREAD],
      prepareNotifications: () => ({
        drafts: [DRAFT],
        wakesTurn: false,
        acknowledge: () => { calls.push('agents:acknowledge') },
      }),
    }
    await teardownSession({
      sources: [quiet], log: recordingLog(calls), ids: new RandomIds(),
      stopSandbox: async () => { calls.push('sandbox:stop') },
    })
    expect(calls).toEqual(['agents:closeAll', 'log:append', 'agents:acknowledge', 'sandbox:stop'])
  })

  it('flushes through the shared intake when one is present, covering retained adapter state', async () => {
    const calls: string[] = []
    const intakeSource = {
      subscribe: () => () => undefined,
      threadsAwaitingInput: () => [THREAD],
      prepare: () => ({
        drafts: [DRAFT], wakesTurn: true,
        acknowledge: () => { calls.push('intake:acknowledge') },
      }),
    }
    const intake = new MessageIntake({ sources: [intakeSource] })
    await teardownSession({
      sources: [recordingSource({ calls, name: 'shells' })],
      log: recordingLog(calls), ids: new RandomIds(), intake,
      stopSandbox: async () => { calls.push('sandbox:stop') },
    })
    expect(calls).toEqual(['shells:closeAll', 'log:append', 'intake:acknowledge', 'sandbox:stop'])
    intake.dispose()
  })

  it('does not acknowledge input when its teardown append fails', async () => {
    const calls: string[] = []
    const pending: TeardownSource = {
      ...recordingSource({ calls, name: 'shells', drafts: [DRAFT] }),
      prepareNotifications: () => ({
        drafts: [DRAFT], wakesTurn: true,
        acknowledge: () => { calls.push('shells:acknowledge') },
        release: () => { calls.push('shells:release') },
      }),
    }
    const log = recordingLog(calls)
    log.append = async () => { throw new Error('append failed') }
    await expect(teardownSession({
      sources: [pending], log, ids: new RandomIds(),
      stopSandbox: async () => { calls.push('sandbox:stop') },
    })).rejects.toThrow('append failed')
    expect(calls).toEqual(['shells:closeAll', 'shells:release', 'sandbox:stop'])
  })

  it('stops the sandbox even when a registry refuses to close', async () => {
    const calls: string[] = []
    const broken = recordingSource({ calls, name: 'broken', throws: true })
    let stopped = false

    await expect(
      teardownSession({
        sources: [broken],
        log: recordingLog(calls),
        ids: new RandomIds(),
        stopSandbox: async () => {
          stopped = true
        },
      }),
    ).rejects.toThrow('broken would not close')

    expect(stopped).toBe(true)
  })
})

const liveThreadLog = (threadId: ThreadId, drafts: readonly EventDraft[]): EventLogPort =>
  new (class extends EventLogPort {
    async append(): Promise<never[]> {
      return []
    }

    async read(): Promise<never[]> {
      return []
    }

    async refresh(): Promise<void> {}

    async head(): Promise<number> {
      return 0
    }

    async readOwn(): Promise<Event[]> {
      return drafts.map((draft, index) => ({
        ...draft,
        id: toEventId(`teardown-${index + 1}`),
        seq: index + 1,
        threadId,
        runId: toRunId('run-1'),
        depth: 0,
        at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      }))
    }

    async replace(): Promise<never[]> {
      return []
    }
  })()

const recordingLogPort = (entries: LogEntry[]): LogPort =>
  new (class extends LogPort {
    record(entry: LogEntry): void {
      entries.push(entry)
    }
  })()

const liveUnitsDrafts: readonly EventDraft[] = [
  { type: 'agent-spawned', agentId: toThreadId('child-1'), agentType: 'builder', intent: 'build', mode: EAgentStart.Fresh },
  { type: 'background-shell-started', shellId: 'bash_1', command: 'sleep 60' },
  { type: 'service-started', serviceId: 'svc-1', command: 'bun run dev' },
]

describe('teardownSession ordered by the ownership projection', () => {
  const ownedSource = (args: {
    calls: string[]
    name: string
    unitIds: readonly string[]
  }): TeardownSource => ({
    closeAll: async () => {
      args.calls.push(`${args.name}:closeAll`)
    },
    threadsAwaitingNotice: () => [],
    threadsWithPendingInput: () => [THREAD],
    drainNotifications: () => [],
    liveUnitIds: () => args.unitIds,
  })

  it('closes agents, then shells, then services, awaiting each', async () => {
    const calls: string[] = []
    const agents = ownedSource({ calls, name: 'agents', unitIds: ['child-1'] })
    const shells = ownedSource({ calls, name: 'shells', unitIds: ['bash_1'] })
    const services = ownedSource({ calls, name: 'services', unitIds: ['svc-1'] })

    await teardownSession({
      sources: [services, agents, shells],
      log: liveThreadLog(THREAD, liveUnitsDrafts),
      ids: new RandomIds(),
      ownedKinds: { agents, shells, services },
      stopSandbox: async () => {
        calls.push('sandbox:stop')
      },
    })

    expect(calls).toEqual(['agents:closeAll', 'shells:closeAll', 'services:closeAll', 'sandbox:stop'])
  })

  it('warns about a live unit the log shows but no registry claims', async () => {
    const calls: string[] = []
    const entries: LogEntry[] = []
    const agents = ownedSource({ calls, name: 'agents', unitIds: ['child-1'] })
    const shells = ownedSource({ calls, name: 'shells', unitIds: [] })
    const services = ownedSource({ calls, name: 'services', unitIds: ['svc-1'] })

    await teardownSession({
      sources: [agents, shells, services],
      log: liveThreadLog(THREAD, liveUnitsDrafts),
      ids: new RandomIds(),
      ownedKinds: { agents, shells, services },
      logPort: recordingLogPort(entries),
      stopSandbox: async () => {},
    })

    const lost = entries.filter(
      (entry) => entry.severity === ELogSeverity.Warn && entry.source === 'session-teardown.ownership',
    )
    expect(lost.map((entry) => entry.data?.['unitId'])).toEqual(['bash_1'])
    expect(calls).toEqual(['agents:closeAll', 'shells:closeAll', 'services:closeAll'])
  })

  it('closes sources with no ownership kind after the owned kinds', async () => {
    const calls: string[] = []
    const agents = ownedSource({ calls, name: 'agents', unitIds: ['child-1'] })
    const services = ownedSource({ calls, name: 'services', unitIds: ['svc-1'] })
    const misc = recordingSource({ calls, name: 'misc' })

    await teardownSession({
      sources: [misc, agents, services],
      log: liveThreadLog(THREAD, liveUnitsDrafts),
      ids: new RandomIds(),
      ownedKinds: { agents, services },
      stopSandbox: async () => {},
    })

    expect(calls).toEqual(['agents:closeAll', 'services:closeAll', 'misc:closeAll'])
  })

  it('closes in source order when the log cannot be read, and warns', async () => {
    const calls: string[] = []
    const entries: LogEntry[] = []
    const agents = ownedSource({ calls, name: 'agents', unitIds: ['child-1'] })
    const shells = ownedSource({ calls, name: 'shells', unitIds: ['bash_1'] })
    const services = ownedSource({ calls, name: 'services', unitIds: ['svc-1'] })
    const log = liveThreadLog(THREAD, liveUnitsDrafts)
    log.readOwn = async () => {
      throw new Error('log is gone')
    }

    await teardownSession({
      sources: [shells, agents, services],
      log,
      ids: new RandomIds(),
      ownedKinds: { agents, shells, services },
      logPort: recordingLogPort(entries),
      stopSandbox: async () => {},
    })

    expect(calls).toEqual(['agents:closeAll', 'shells:closeAll', 'services:closeAll'])
    expect(entries.some((entry) => entry.severity === ELogSeverity.Warn)).toBe(true)
  })
})
