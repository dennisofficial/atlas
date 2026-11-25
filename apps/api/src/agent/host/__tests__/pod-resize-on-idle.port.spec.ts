import { describe, expect, it } from 'bun:test'
import type { ControlSessionRow, ControlTx } from '@dltech/atlas-control'
import { initialSessionViewState, type SessionViewState } from '@dltech/atlas-core'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

import {
  JobsProjectDispatcher,
  type AnyTask,
  type JobDispatch,
} from '../../../_core/ports/job-dispatcher'
import { podResizeOnIdleOf } from '../pod-resize-on-idle.port'

const NOW = '2026-11-25T12:00:00.000Z'
const WAITED = '2026-11-25T11:00:00.000Z'
const SESSION = 'pod-a'

class RecordingDispatcher extends JobsProjectDispatcher {
  readonly dispatches: { taskId: string; payload: unknown; idempotencyKey: string }[] = []
  failure: Error | undefined

  async dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }> {
    if (this.failure !== undefined) throw this.failure
    this.dispatches.push({
      taskId: args.task.id,
      payload: args.payload,
      idempotencyKey: args.idempotencyKey,
    })
    return { runId: 'run_stub' }
  }
}

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const shell = (status: 'running' | 'exited') => ({
  shellId: 'sh-1',
  name: 'dev',
  command: 'bun dev',
  status,
  characters: 0,
  awaitingInput: false,
  changedAt: NOW,
})

const withShell = (status: 'running' | 'exited'): SessionViewState => ({
  ...initialSessionViewState,
  pluginViews: { shells: [shell(status)] },
})

const sessionRow: ControlSessionRow = {
  sessionId: SESSION,
  podSizeGeneration: 4,
  podWaitingSince: WAITED,
  podDesiredVcpus: 8,
  podDesiredMemoryGb: 32,
  podDesiredDiskGb: null,
} as ControlSessionRow

const endOfLastShell = async (args: {
  dispatcher: JobsProjectDispatcher
  log: LogPort
}): Promise<void> => {
  const tx = { lockSession: async () => sessionRow } as unknown as ControlTx
  await podResizeOnIdleOf(args).handle({
    tx,
    sessionId: SESSION,
    before: withShell('running'),
    after: withShell('exited'),
    now: NOW,
  })
}

describe('podResizeOnIdleOf', () => {
  it('dispatches the waiting resize through the job contract the task id names', async () => {
    const dispatcher = new RecordingDispatcher()

    await endOfLastShell({ dispatcher, log: new RecordingLog() })

    expect(dispatcher.dispatches).toEqual([
      {
        taskId: 'pod-resize',
        payload: {
          sessionId: SESSION,
          generation: 4,
          vcpus: 8,
          memoryGb: 32,
          whenIdle: true,
          waitedSince: WAITED,
        },
        idempotencyKey: `pod-resize:${SESSION}:4:idle:${WAITED}`,
      },
    ])
  })

  it('warns instead of failing the append when the dispatch is refused', async () => {
    const dispatcher = new RecordingDispatcher()
    dispatcher.failure = new Error('trigger.dev is down')
    const log = new RecordingLog()

    await endOfLastShell({ dispatcher, log })

    expect(dispatcher.dispatches).toHaveLength(0)
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Warn)
    expect(log.entries[0]?.source).toBe('agent.host.pod-resize-on-idle')
    expect(log.entries[0]?.error).toBe('trigger.dev is down')
  })

  it('leaves the session alone when the last shell was not the edge', async () => {
    const dispatcher = new RecordingDispatcher()
    const tx = { lockSession: async () => sessionRow } as unknown as ControlTx

    await podResizeOnIdleOf({ dispatcher, log: new RecordingLog() }).handle({
      tx,
      sessionId: SESSION,
      before: withShell('exited'),
      after: withShell('exited'),
      now: NOW,
    })

    expect(dispatcher.dispatches).toHaveLength(0)
  })
})
