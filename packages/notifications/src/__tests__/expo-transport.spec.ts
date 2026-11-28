import { describe, expect, it } from 'bun:test'
import { ENotifyMoment, type AtlasNotification } from '@dltech/atlas-core'
import { z } from 'zod'

import { ENotifyDeviceKind, type NotifyDevice } from '../model'
import {
  EExpoSendError,
  EXPO_PUSH_BATCH_SIZE,
  EXPO_PUSH_URL,
  expoTransport,
  type ExpoFetch,
} from '../transports/expo'

const NOTIFICATION: AtlasNotification = {
  sessionId: 'session-1',
  seq: 7,
  moment: ENotifyMoment.TurnFinished,
  title: 'Fix the parser',
  body: 'Finished',
  at: '2026-11-23T14:02:00.000Z',
}

const deviceOf = (overrides: Partial<NotifyDevice> = {}): NotifyDevice => ({
  id: 'device-1',
  kind: ENotifyDeviceKind.Expo,
  token: 'ExponentPushToken[token-1]',
  secret: null,
  ...overrides,
})

const messageSchema = z.array(z.record(z.string(), z.unknown()))

type Reply = { status: number; json(): Promise<unknown> }

const recorderOf = (reply?: (messages: readonly Record<string, unknown>[]) => Reply) => {
  const calls: {
    url: string
    messages: readonly Record<string, unknown>[]
    headers: Record<string, string>
  }[] = []
  const fetch: ExpoFetch = async (url, init) => {
    const messages = messageSchema.parse(JSON.parse(init.body))
    calls.push({ url, messages, headers: init.headers })
    return reply === undefined
      ? { status: 200, json: async () => ({ data: messages.map(() => ({ status: 'ok' })) }) }
      : reply(messages)
  }
  return { calls, fetch }
}

describe('expoTransport.deliver', () => {
  it('posts the alert with the copy, a collapse id, a thread id and the session data', async () => {
    const recorder = recorderOf()

    await expoTransport({ fetch: recorder.fetch }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })

    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.url).toBe(EXPO_PUSH_URL)
    expect(recorder.calls[0]?.messages).toEqual([
      {
        to: 'ExponentPushToken[token-1]',
        title: 'Fix the parser',
        body: 'Finished',
        sound: 'default',
        categoryId: 'atlas-notification',
        collapseId: 'session-1',
        threadId: 'session-1',
        data: {
          sessionId: 'session-1',
          seq: 7,
          moment: ENotifyMoment.TurnFinished,
          sentAt: '2026-11-23T14:02:00.000Z',
        },
      },
    ])
  })

  it('omits the sound of a notification that must not make one', async () => {
    const recorder = recorderOf()

    await expoTransport({ fetch: recorder.fetch }).deliver({
      devices: [deviceOf()],
      notification: { ...NOTIFICATION, silent: true },
    })

    expect(recorder.calls[0]?.messages[0]).not.toHaveProperty('sound')
  })

  it('names the routine in the data of a routine notice', async () => {
    const recorder = recorderOf()

    await expoTransport({ fetch: recorder.fetch }).deliver({
      devices: [deviceOf()],
      notification: { ...NOTIFICATION, routineId: 'rtn-1' },
    })

    expect(recorder.calls[0]?.messages[0]?.['data']).toEqual({
      sessionId: 'session-1',
      seq: 7,
      routineId: 'rtn-1',
      moment: ENotifyMoment.TurnFinished,
      sentAt: '2026-11-23T14:02:00.000Z',
    })
  })

  it('sends the access token as a bearer credential only when there is one', async () => {
    const withToken = recorderOf()
    const without = recorderOf()

    await expoTransport({ accessToken: 'secret', fetch: withToken.fetch }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })
    await expoTransport({ fetch: without.fetch }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })

    expect(withToken.calls[0]?.headers['authorization']).toBe('Bearer secret')
    expect(without.calls[0]?.headers['authorization']).toBeUndefined()
  })

  it('splits more devices than one batch into several posts', async () => {
    const recorder = recorderOf()
    const devices = Array.from({ length: EXPO_PUSH_BATCH_SIZE + 1 }, (_value, index) =>
      deviceOf({ id: `device-${index}`, token: `ExponentPushToken[token-${index}]` }),
    )

    const results = await expoTransport({ fetch: recorder.fetch }).deliver({
      devices,
      notification: NOTIFICATION,
    })

    expect(recorder.calls.map((call) => call.messages.length)).toEqual([EXPO_PUSH_BATCH_SIZE, 1])
    expect(results).toHaveLength(EXPO_PUSH_BATCH_SIZE + 1)
    expect(results.every((result) => result.sent)).toBe(true)
  })

  it('marks a token Expo no longer knows as gone and leaves the other device sent', async () => {
    const recorder = recorderOf((messages) => ({
      status: 200,
      json: async () => ({
        data: messages.map((_message, index) =>
          index === 1
            ? {
                status: 'error',
                message: 'not registered',
                details: { error: 'DeviceNotRegistered' },
              }
            : { status: 'ok', id: 'ticket-1' },
        ),
      }),
    }))

    const results = await expoTransport({ fetch: recorder.fetch }).deliver({
      devices: [deviceOf(), deviceOf({ id: 'device-2', token: 'ExponentPushToken[dead]' })],
      notification: NOTIFICATION,
    })

    expect(results).toEqual([
      { deviceId: 'device-1', sent: true },
      { deviceId: 'device-2', sent: false, gone: true, error: 'DeviceNotRegistered' },
    ])
  })

  it('names the error of a ticket that Expo refused', async () => {
    const recorder = recorderOf((messages) => ({
      status: 200,
      json: async () => ({
        data: messages.map(() => ({
          status: 'error',
          message: 'credentials',
          details: { error: 'InvalidCredentials' },
        })),
      }),
    }))

    const results = await expoTransport({ fetch: recorder.fetch }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })

    expect(results).toEqual([{ deviceId: 'device-1', sent: false, error: 'InvalidCredentials' }])
  })

  it('names the code of a batch refused without an access token', async () => {
    const recorder = recorderOf(() => ({
      status: 403,
      json: async () => ({
        errors: [{ code: 'UNAUTHORIZED', message: 'Insufficient permissions to send push' }],
      }),
    }))

    const results = await expoTransport({ fetch: recorder.fetch }).deliver({
      devices: [deviceOf(), deviceOf({ id: 'device-2' })],
      notification: NOTIFICATION,
    })

    expect(results).toEqual([
      { deviceId: 'device-1', sent: false, error: 'UNAUTHORIZED' },
      { deviceId: 'device-2', sent: false, error: 'UNAUTHORIZED' },
    ])
  })

  it('reports every device unsent when the push service refuses the batch', async () => {
    const refused = recorderOf(() => ({ status: 503, json: async () => ({}) }))
    const malformed = recorderOf(() => ({ status: 200, json: async () => ({ data: [] }) }))

    const refusedResults = await expoTransport({ fetch: refused.fetch }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })
    const malformedResults = await expoTransport({ fetch: malformed.fetch }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })

    expect(refusedResults).toEqual([{ deviceId: 'device-1', sent: false, error: `http-503` }])
    expect(malformedResults).toEqual([
      { deviceId: 'device-1', sent: false, error: EExpoSendError.UnexpectedReply },
    ])
  })

  it('reports every device unsent when the push service cannot be reached', async () => {
    const fetch: ExpoFetch = () => Promise.reject(new Error('offline'))

    const results = await expoTransport({ fetch }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })

    expect(results).toEqual([
      { deviceId: 'device-1', sent: false, error: EExpoSendError.Unreachable },
    ])
  })
})

describe('expoTransport.clear', () => {
  it('posts a headless notification that names the session to clear', async () => {
    const recorder = recorderOf()

    const results = await expoTransport({ fetch: recorder.fetch }).clear({
      devices: [deviceOf()],
      sessionId: 'session-1',
    })

    expect(recorder.calls[0]?.messages).toEqual([
      {
        to: 'ExponentPushToken[token-1]',
        contentAvailable: true,
        data: { clearSessionId: 'session-1' },
      },
    ])
    expect(results).toEqual([{ deviceId: 'device-1', sent: true }])
  })
})
