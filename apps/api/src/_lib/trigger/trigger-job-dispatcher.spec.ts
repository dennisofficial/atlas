import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import type { Task, TaskContract } from '../../_core/ports/job-dispatcher'
import { JobDispatchError } from '../../_core/ports/job-dispatcher'

const trigger = vi.fn()
const constructed: unknown[] = []

vi.mock('@trigger.dev/sdk', () => ({
  TriggerClient: class {
    readonly tasks = { trigger }
    constructor(config: unknown) {
      constructed.push(config)
    }
  },
}))

import { TriggerJobDispatcher } from './trigger-job-dispatcher'

type EchoTask = Task<'echo', { message: string }, { echoed: string }>

const echoContract: TaskContract<EchoTask> = {
  id: 'echo',
  schema: z.object({ message: z.string().min(1) }),
}

describe('TriggerJobDispatcher', () => {
  beforeEach(() => {
    trigger.mockReset()
    constructed.length = 0
  })

  it('authenticates its client with the configured secret key', () => {
    new TriggerJobDispatcher({ secretKey: 'tr_dev_example' })
    expect(constructed).toEqual([{ accessToken: 'tr_dev_example' }])
  })

  it('triggers the contract id with the payload, idempotency key and tags', async () => {
    trigger.mockResolvedValue({ id: 'run_123' })
    const dispatcher = new TriggerJobDispatcher({ secretKey: 'tr_dev_example' })

    const result = await dispatcher.dispatch({
      task: echoContract,
      payload: { message: 'hi' },
      idempotencyKey: 'echo-1',
      tags: ['thread:abc'],
    })

    expect(result).toEqual({ runId: 'run_123' })
    expect(trigger).toHaveBeenCalledWith(
      'echo',
      { message: 'hi' },
      { idempotencyKey: 'echo-1', tags: ['thread:abc'] },
    )
  })

  it('omits tags when the caller gives none', async () => {
    trigger.mockResolvedValue({ id: 'run_456' })
    const dispatcher = new TriggerJobDispatcher({ secretKey: 'tr_dev_example' })

    await dispatcher.dispatch({ task: echoContract, payload: { message: 'hi' }, idempotencyKey: 'k' })

    expect(trigger).toHaveBeenCalledWith('echo', { message: 'hi' }, { idempotencyKey: 'k' })
  })

  it('throws a JobDispatchError carrying the task id when the SDK fails', async () => {
    trigger.mockRejectedValue(new Error('401 unauthorized'))
    const dispatcher = new TriggerJobDispatcher({ secretKey: 'tr_dev_example' })

    const failure = await dispatcher
      .dispatch({ task: echoContract, payload: { message: 'hi' }, idempotencyKey: 'k' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(JobDispatchError)
    expect(failure).toMatchObject({ taskId: 'echo', message: expect.stringContaining('401') })
  })

  it('refuses a payload the contract schema rejects without calling the SDK', async () => {
    const dispatcher = new TriggerJobDispatcher({ secretKey: 'tr_dev_example' })

    await expect(
      dispatcher.dispatch({ task: echoContract, payload: { message: '' }, idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(JobDispatchError)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('types the payload from the contract', () => {
    const dispatcher = new TriggerJobDispatcher({ secretKey: 'tr_dev_example' })
    type DispatchArgs = Parameters<typeof dispatcher.dispatch<EchoTask>>[0]
    expectTypeOf<DispatchArgs['payload']>().toEqualTypeOf<{ message: string }>()
  })
})
