import { describe, expect, it } from 'bun:test'

import { EventLogPort, EShellStatus, toThreadId, type EventDraft } from '@dltech/atlas-core'
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
