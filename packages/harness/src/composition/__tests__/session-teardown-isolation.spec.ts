import { describe, expect, it } from 'bun:test'

import { EventLogPort, EShellStatus, toThreadId, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import { RandomIds } from '@dltech/atlas-harness'

import { teardownSession, type TeardownShellSource, type TeardownSource } from '../session-teardown'

const FIRST = toThreadId('thread-first')
const SECOND = toThreadId('thread-second')

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

class FailingLog extends EventLogPort {
  private broken = 0

  constructor(private readonly calls: string[]) {
    super()
  }

  failNextAppends(times: number): void {
    this.broken = times
  }

  async append(args: { threadId: ThreadId }): Promise<never[]> {
    this.calls.push(`log:append:${args.threadId}`)
    if (this.broken > 0) {
      this.broken -= 1
      throw new Error('append failed')
    }
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
}

const recordingLog = (calls: string[]): FailingLog => new FailingLog(calls)

const twoThreadSource = (calls: string[]): TeardownSource => ({
  closeAll: async () => {
    calls.push('shells:closeAll')
  },
  threadsAwaitingNotice: () => [FIRST, SECOND],
  drainNotifications: ({ threadId }) => {
    calls.push(`shells:drain:${threadId}`)
    return [DRAFT]
  },
})

describe('teardownSession per-thread failure isolation', () => {
  it('persists the second thread when the first thread append fails, and rejects with that failure', async () => {
    const calls: string[] = []
    const log = recordingLog(calls)
    log.failNextAppends(1)

    await expect(
      teardownSession({
        sources: [twoThreadSource(calls)],
        log,
        ids: new RandomIds(),
        stopSandbox: async () => {
          calls.push('sandbox:stop')
        },
      }),
    ).rejects.toThrow('append failed')

    expect(calls).toEqual([
      'shells:closeAll',
      `shells:drain:${FIRST}`,
      `log:append:${FIRST}`,
      `shells:drain:${SECOND}`,
      `log:append:${SECOND}`,
      'sandbox:stop',
    ])
  })

  it('still reconciles unresolved endings after a drain failure, and rejects with the original', async () => {
    const calls: string[] = []
    const log = recordingLog(calls)
    log.failNextAppends(1)
    const shells: TeardownShellSource = {
      ...twoThreadSource(calls),
      threadsWithUnresolvedEndings: () => [FIRST],
      recordEndings: async () => {
        calls.push('shells:recordEndings')
      },
    }

    await expect(
      teardownSession({
        sources: [shells],
        log,
        ids: new RandomIds(),
        stopSandbox: async () => {
          calls.push('sandbox:stop')
        },
      }),
    ).rejects.toThrow('append failed')

    expect(calls).toEqual([
      'shells:closeAll',
      `shells:drain:${FIRST}`,
      `log:append:${FIRST}`,
      `shells:drain:${SECOND}`,
      `log:append:${SECOND}`,
      'shells:recordEndings',
      'sandbox:stop',
    ])
  })

  it('does not acknowledge the failed thread, but acknowledges the persisted one', async () => {
    const calls: string[] = []
    const log = recordingLog(calls)
    log.failNextAppends(1)
    const prepared: TeardownSource = {
      closeAll: async () => {
        calls.push('agents:closeAll')
      },
      threadsAwaitingNotice: () => [FIRST, SECOND],
      drainNotifications: () => [],
      prepareNotifications: ({ threadId }) => ({
        drafts: [DRAFT],
        wakesTurn: true,
        acknowledge: () => {
          calls.push(`agents:acknowledge:${threadId}`)
        },
        release: () => {
          calls.push(`agents:release:${threadId}`)
        },
      }),
    }

    await expect(
      teardownSession({
        sources: [prepared],
        log,
        ids: new RandomIds(),
        stopSandbox: async () => {
          calls.push('sandbox:stop')
        },
      }),
    ).rejects.toThrow('append failed')

    expect(calls).toEqual([
      'agents:closeAll',
      `log:append:${FIRST}`,
      `agents:release:${FIRST}`,
      `log:append:${SECOND}`,
      `agents:acknowledge:${SECOND}`,
      `agents:release:${SECOND}`,
      'sandbox:stop',
    ])
  })
})
