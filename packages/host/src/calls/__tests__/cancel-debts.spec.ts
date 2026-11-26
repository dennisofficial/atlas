import { describe, expect, it } from 'bun:test'

import {
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type EventBody,
  type Stamped,
} from '@dltech/atlas-core'

import { cancelDebtsOf } from '../cancel-debts'

const eventOf = <TBody extends EventBody>(body: TBody): Stamped<TBody> =>
  ({
    ...body,
    id: toEventId('event-1'),
    seq: 1,
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-01-01T00:00:00.000Z',
  }) as Stamped<TBody>

const DISPATCHED = eventOf({
  type: 'tool-dispatched',
  callId: toCallId('call-1'),
  name: 'fault_exec',
  bootId: 'boot-a',
})

const STOPPED = eventOf({
  type: 'tool-result',
  callId: toCallId('call-1'),
  name: 'fault_exec',
  interrupted: true,
  error: { message: 'the pod refused attempt 0' },
})

describe('the pod keys a stopped call may still be running', () => {
  it('names each recorded step of the call, with the boot the daemon knows it on', () => {
    const debts = cancelDebtsOf({
      events: [DISPATCHED, STOPPED],
      stepsOf: () => [{ key: 'call-1.0', bootId: 'boot-a' }, { key: 'call-1.1' }],
      daemonTools: new Set(['bash']),
    })
    expect(debts).toEqual([
      { key: 'call-1.0', bootId: 'boot-a' },
      { key: 'call-1.1', bootId: 'boot-a' },
    ])
  })

  it('names the built-in scoped key of a stopped built-in tool with no recorded step', () => {
    const debts = cancelDebtsOf({
      events: [
        eventOf({
          type: 'tool-dispatched',
          callId: toCallId('call-1'),
          name: 'bash',
          bootId: 'boot-a',
        }),
        STOPPED,
      ],
      stepsOf: () => [],
      daemonTools: new Set(['bash']),
    })
    expect(debts).toEqual([{ key: 'call-1.0', bootId: 'boot-a' }])
  })

  it('names nothing for a stopped plugin call that recorded no step', () => {
    const debts = cancelDebtsOf({
      events: [DISPATCHED, STOPPED],
      stepsOf: () => [],
      daemonTools: new Set(['bash']),
    })
    expect(debts).toEqual([])
  })

  it('names nothing for a call that was not interrupted', () => {
    const debts = cancelDebtsOf({
      events: [
        eventOf({
          type: 'tool-dispatched',
          callId: toCallId('call-1'),
          name: 'bash',
          bootId: 'boot-a',
        }),
        eventOf({ type: 'tool-result', callId: toCallId('call-1'), name: 'bash', output: 'done' }),
      ],
      stepsOf: () => [],
      daemonTools: new Set(['bash']),
    })
    expect(debts).toEqual([])
  })
})
