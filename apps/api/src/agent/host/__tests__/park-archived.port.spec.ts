import { POD_SLEEP_TASK_ID, podSleepPayloadSchema } from '@dltech/atlas-jobs/pod-sleep'
import { describe, expect, it } from 'bun:test'

import {
  JobsProjectDispatcher,
  type AnyTask,
  type JobDispatch,
} from '../../../_core/ports/job-dispatcher'
import { ELogSeverity, type LogEntry, LogPort } from '@dltech/atlas-observability'

import { parkArchivedDispatchOf, type ParkArchivedPlane } from '../park-archived.port'

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

const planeOf = (
  args: {
    session?: { sessionId: string; podSessionId: string | null } | null
    peers?: number
    epoch?: number
    readFailure?: Error
  } = {},
): ParkArchivedPlane => ({
  readSession: async () => {
    if (args.readFailure !== undefined) throw args.readFailure
    if (args.session === null) return undefined
    return args.session ?? { sessionId: 'p1', podSessionId: 'p1' }
  },
  podPeersPlaced: async () => args.peers ?? 0,
  currentLease: async () => ({ lease: { epoch: args.epoch ?? 4 } }),
})

describe('parkArchived dispatch port', () => {
  it('dispatches pod-sleep for the epoch of the archived session’s lease', async () => {
    const dispatcher = new RecordingDispatcher()
    const parkArchived = parkArchivedDispatchOf({
      plane: planeOf({ epoch: 9 }),
      dispatcher,
      log: new RecordingLog(),
    })

    await parkArchived({ sessionId: 'p1' })

    expect(dispatcher.dispatches).toEqual([
      {
        taskId: POD_SLEEP_TASK_ID,
        payload: { sessionId: 'p1', epoch: 9 },
        idempotencyKey: 'pod-sleep:p1:9',
      },
    ])
    expect(podSleepPayloadSchema.parse(dispatcher.dispatches[0]?.payload)).toEqual({
      sessionId: 'p1',
      epoch: 9,
    })
  })

  it('sleeps nothing when the archived session is gone', async () => {
    const dispatcher = new RecordingDispatcher()
    const parkArchived = parkArchivedDispatchOf({
      plane: planeOf({ session: null }),
      dispatcher,
      log: new RecordingLog(),
    })

    await parkArchived({ sessionId: 'gone' })

    expect(dispatcher.dispatches).toEqual([])
  })

  it('sleeps nothing when the session shares another session’s pod', async () => {
    const dispatcher = new RecordingDispatcher()
    const parkArchived = parkArchivedDispatchOf({
      plane: planeOf({ session: { sessionId: 'p1', podSessionId: 'p0' } }),
      dispatcher,
      log: new RecordingLog(),
    })

    await parkArchived({ sessionId: 'p1' })

    expect(dispatcher.dispatches).toEqual([])
  })

  it('sleeps nothing when a peer session is placed on the same pod', async () => {
    const dispatcher = new RecordingDispatcher()
    const parkArchived = parkArchivedDispatchOf({
      plane: planeOf({ peers: 1 }),
      dispatcher,
      log: new RecordingLog(),
    })

    await parkArchived({ sessionId: 'p1' })

    expect(dispatcher.dispatches).toEqual([])
  })

  it('logs a failed dispatch and never throws, because the archive already happened', async () => {
    const dispatcher = new RecordingDispatcher()
    dispatcher.failure = new Error('trigger refused')
    const log = new RecordingLog()
    const parkArchived = parkArchivedDispatchOf({ plane: planeOf(), dispatcher, log })

    await parkArchived({ sessionId: 'p1' })

    expect(log.entries).toEqual([
      {
        severity: ELogSeverity.Warn,
        source: 'agent.host.park-archived',
        message: 'parking the pod of archived session p1 failed',
        error: 'trigger refused',
      },
    ])
  })

  it('logs a failed read and never throws', async () => {
    const log = new RecordingLog()
    const parkArchived = parkArchivedDispatchOf({
      plane: planeOf({ readFailure: new Error('the control plane is unreachable') }),
      dispatcher: new RecordingDispatcher(),
      log,
    })

    await parkArchived({ sessionId: 'p1' })

    expect(log.entries.map((entry) => entry.error)).toEqual(['the control plane is unreachable'])
  })
})
