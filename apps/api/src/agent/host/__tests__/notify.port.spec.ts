import {
  ENotifyMoment,
  ENotifyVerdict,
  EPendingWork,
  toThreadId,
  type NotifyDecision,
} from '@dltech/atlas-core'
import { NOTIFY_SEND_TASK_ID, notifySendPayloadSchema } from '@dltech/atlas-jobs/notify'
import { describe, expect, it } from 'bun:test'

import {
  JobsProjectDispatcher,
  type AnyTask,
  type JobDispatch,
} from '../../../_core/ports/job-dispatcher'
import { notifyDispatchOf } from '../notify.port'

const decisionOf = (over: Partial<NotifyDecision> = {}): NotifyDecision => ({
  moment: ENotifyMoment.TurnFinished,
  verdict: ENotifyVerdict.Send,
  holdMs: 0,
  pending: [],
  operatorTurn: false,
  ...over,
})

class RecordingDispatcher extends JobsProjectDispatcher {
  readonly dispatches: {
    taskId: string
    payload: unknown
    idempotencyKey: string
    delay?: string
  }[] = []
  failure: Error | undefined

  async dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }> {
    if (this.failure !== undefined) throw this.failure
    this.dispatches.push({
      taskId: args.task.id,
      payload: args.payload,
      idempotencyKey: args.idempotencyKey,
      ...(args.delay === undefined ? {} : { delay: args.delay }),
    })
    return { runId: 'run_stub' }
  }
}

describe('notify dispatch port', () => {
  it('dispatches notify-send for the session and the seq of the event', async () => {
    const dispatcher = new RecordingDispatcher()
    const notify = notifyDispatchOf({ dispatcher })

    await notify({
      sessionId: 'session-1',
      threadId: toThreadId('thread-1'),
      seq: 7,
      moment: ENotifyMoment.TurnFinished,
      decision: decisionOf(),
    })

    expect(dispatcher.dispatches).toEqual([
      {
        taskId: NOTIFY_SEND_TASK_ID,
        payload: {
          sessionId: 'session-1',
          threadId: 'thread-1',
          seq: 7,
          moment: ENotifyMoment.TurnFinished,
          holdMs: 0,
          pending: [],
          operatorTurn: false,
        },
        idempotencyKey: 'notify:session-1:7',
      },
    ])
  })

  it('waits the hold of the decision before the task runs, under the same key', async () => {
    const dispatcher = new RecordingDispatcher()
    const notify = notifyDispatchOf({ dispatcher })

    await notify({
      sessionId: 'session-1',
      threadId: toThreadId('thread-1'),
      seq: 8,
      moment: ENotifyMoment.TurnFinished,
      decision: decisionOf({
        verdict: ENotifyVerdict.Hold,
        holdMs: 3_600_000,
        pending: [EPendingWork.Shell],
        operatorTurn: true,
      }),
    })

    expect(dispatcher.dispatches[0]?.delay).toBe('3600s')
    expect(dispatcher.dispatches[0]?.idempotencyKey).toBe('notify:session-1:8')
    expect(dispatcher.dispatches[0]?.payload).toMatchObject({
      holdMs: 3_600_000,
      pending: [EPendingWork.Shell],
      operatorTurn: true,
    })
  })

  it('sends a payload the notify-send task contract accepts', async () => {
    const dispatcher = new RecordingDispatcher()
    const notify = notifyDispatchOf({ dispatcher })

    await notify({
      sessionId: 'session-2',
      threadId: toThreadId('thread-2'),
      seq: 3,
      moment: ENotifyMoment.WaitingForYou,
      decision: decisionOf({ moment: ENotifyMoment.WaitingForYou }),
    })

    const sent = dispatcher.dispatches[0]
    expect(notifySendPayloadSchema.parse(sent?.payload)).toEqual({
      sessionId: 'session-2',
      threadId: 'thread-2',
      seq: 3,
      moment: ENotifyMoment.WaitingForYou,
      holdMs: 0,
      pending: [],
      operatorTurn: false,
    })
  })

  it('rejects when the dispatcher refuses the job', async () => {
    const dispatcher = new RecordingDispatcher()
    dispatcher.failure = new Error('trigger refused')
    const notify = notifyDispatchOf({ dispatcher })

    const dispatched = notify({
      sessionId: 'session-3',
      threadId: toThreadId('thread-3'),
      seq: 1,
      moment: ENotifyMoment.TurnFailed,
      decision: decisionOf({ moment: ENotifyMoment.TurnFailed }),
    })

    await expect(dispatched).rejects.toThrow('trigger refused')
  })
})
