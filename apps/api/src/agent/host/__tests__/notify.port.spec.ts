import { ENotifyMoment, toThreadId } from '@dltech/atlas-core'
import { NOTIFY_SEND_TASK_ID, notifySendPayloadSchema } from '@dltech/atlas-jobs/notify'
import { describe, expect, it } from 'bun:test'

import {
  JobsProjectDispatcher,
  type AnyTask,
  type JobDispatch,
} from '../../../_core/ports/job-dispatcher'
import { notifyDispatchOf } from '../notify.port'

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

describe('notify dispatch port', () => {
  it('dispatches notify-send for the session and the seq of the event', async () => {
    const dispatcher = new RecordingDispatcher()
    const notify = notifyDispatchOf({ dispatcher })

    await notify({
      sessionId: 'session-1',
      threadId: toThreadId('thread-1'),
      seq: 7,
      moment: ENotifyMoment.TurnFinished,
    })

    expect(dispatcher.dispatches).toEqual([
      {
        taskId: NOTIFY_SEND_TASK_ID,
        payload: {
          sessionId: 'session-1',
          threadId: 'thread-1',
          seq: 7,
          moment: ENotifyMoment.TurnFinished,
        },
        idempotencyKey: 'notify:session-1:7',
      },
    ])
  })

  it('sends a payload the notify-send task contract accepts', async () => {
    const dispatcher = new RecordingDispatcher()
    const notify = notifyDispatchOf({ dispatcher })

    await notify({
      sessionId: 'session-2',
      threadId: toThreadId('thread-2'),
      seq: 3,
      moment: ENotifyMoment.WaitingForYou,
    })

    const sent = dispatcher.dispatches[0]
    expect(notifySendPayloadSchema.parse(sent?.payload)).toEqual({
      sessionId: 'session-2',
      threadId: 'thread-2',
      seq: 3,
      moment: ENotifyMoment.WaitingForYou,
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
    })

    await expect(dispatched).rejects.toThrow('trigger refused')
  })
})
