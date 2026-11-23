import { describe, expect, it } from 'bun:test'
import {
  ECallFailure,
  ECallStatus,
  ELiveOpFailure,
  type CallOp,
  type CallResult,
} from '@dltech/atlas-protocol'

import { PodParkedError } from './pod-parked.error'
import { asUser, opsOf } from './files.service.fixture'
import { setupSessionsService } from './sessions.service.fixture'
import { ServicesService } from './services.service'

const LIMIT = 64 * 1024

const logResult = (value: { offset: number; text: string; totalBytes: number }): CallResult => ({
  status: ECallStatus.Ok,
  op: 'services.log',
  value: {
    offset: value.offset,
    bytes: Buffer.from(value.text, 'utf8').toString('base64'),
    totalBytes: value.totalBytes,
  },
})

const setup = (results: Parameters<typeof opsOf>[0], seen: CallOp[] = []) => {
  const { service: sessions } = setupSessionsService()
  return { sessions, services: new ServicesService(sessions, opsOf(results, seen)) }
}

const smallLog = logResult({ offset: 0, text: 'listening on :4321\n', totalBytes: 19 })
const bigHead = logResult({ offset: 0, text: 'x'.repeat(LIMIT), totalBytes: 200_000 })

describe('ServicesService', () => {
  it('waits for a holder before it reads the log', async () => {
    const waits: (boolean | undefined)[] = []
    const { service: sessions } = setupSessionsService()
    const services = new ServicesService(sessions, {
      invoke: async (args) => {
        waits.push(args.waitForHolder)
        return { state: 'ok', result: smallLog }
      },
      follow: async () => null,
      events: () => null,
      hold: () => true,
      servesLocally: async () => true,
    })
    const sessionId = await asUser(sessions)
    await services.log({ userId: 'user-a', sessionId, serviceId: 'web' })
    expect(waits).toEqual([true])
  })

  it('reads a short log in one call', async () => {
    const seen: CallOp[] = []
    const { services, sessions } = setup([smallLog], seen)
    const sessionId = await asUser(sessions)

    const output = await services.log({ userId: 'user-a', sessionId, serviceId: 'web' })

    expect(seen[0]).toEqual({ op: 'services.log', serviceId: 'web', offset: 0, limit: LIMIT })
    expect(output).toEqual({ text: 'listening on :4321\n', truncated: false })
  })

  it('reads the tail of a long log and marks it truncated', async () => {
    const seen: CallOp[] = []
    const { services, sessions } = setup(
      [bigHead, logResult({ offset: 134_464, text: 'the end', totalBytes: 200_000 })],
      seen,
    )
    const sessionId = await asUser(sessions)

    const output = await services.log({ userId: 'user-a', sessionId, serviceId: 'web' })

    expect(seen[1]).toEqual({
      op: 'services.log',
      serviceId: 'web',
      offset: 200_000 - LIMIT,
      limit: LIMIT,
    })
    expect(output).toEqual({ text: 'the end', truncated: true })
  })

  it('throws the parked failure when the pod is asleep', async () => {
    const { service: sessions } = setupSessionsService()
    const services = new ServicesService(sessions, {
      invoke: async () => ({ state: 'unavailable', reason: ELiveOpFailure.Asleep }),
      follow: async () => null,
      events: () => null,
      hold: () => true,
      servesLocally: async () => true,
    })
    const sessionId = await asUser(sessions)

    await expect(
      services.log({ userId: 'user-a', sessionId, serviceId: 'web' }),
    ).rejects.toBeInstanceOf(PodParkedError)
  })

  it('reports an unknown service as a bad request', async () => {
    const { services, sessions } = setup([
      {
        status: ECallStatus.Failed,
        op: 'services.log',
        error: { code: ECallFailure.NotFound, message: 'no such service: web' },
      },
    ])
    const sessionId = await asUser(sessions)

    await expect(services.log({ userId: 'user-a', sessionId, serviceId: 'web' })).rejects.toThrow(
      'no such service: web',
    )
  })

  it('refuses a session the caller does not own', async () => {
    const { services } = setup([])

    await expect(
      services.log({ userId: 'user-b', sessionId: 'ses-unknown', serviceId: 'web' }),
    ).rejects.toThrow()
  })
})
