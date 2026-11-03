import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schemaTask: <T>(definition: T): T => definition,
  wait: { for: async () => undefined },
  TriggerClient: class {
    readonly tasks = { trigger: async () => ({ id: 'run_stub' }) }
  },
}))

const { pushSendTaskContract } = await import('../../api/platform/notifications/push-send.contract')
const { pushSendTask } = await import('./push-send.task')

describe('push-send task', () => {
  it('registers under the contract id with three attempts', () => {
    expect(pushSendTask).toMatchObject({ id: 'push-send', retry: { maxAttempts: 3 } })
    expect(pushSendTaskContract.id).toBe(pushSendTask.id)
  })

  it('bounds the payload to 1..100 messages with required fields', () => {
    expect(pushSendTaskContract.schema.safeParse({ messages: [] }).success).toBe(false)
    expect(
      pushSendTaskContract.schema.safeParse({
        messages: [{ to: 'ExponentPushToken[a]', title: 'T', body: 'B' }],
      }).success,
    ).toBe(true)
    expect(
      pushSendTaskContract.schema.safeParse({ messages: [{ to: '', title: 'T', body: 'B' }] })
        .success,
    ).toBe(false)
  })
})
