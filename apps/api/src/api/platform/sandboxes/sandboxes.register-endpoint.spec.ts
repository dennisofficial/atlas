import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { beforeEach, describe, expect, it } from 'bun:test'
import { USER_A } from '../../../../test/session-seed'
import { prepareSandboxes, THREAD, type StubClient } from './sandboxes.fixture'
import type { SandboxesService } from './sandboxes.service'
import { ESandboxState } from './sandboxes.types'

describe('the client-provisioned register path endpoints', () => {
  let client: StubClient
  useTestDatabase()
  let service: SandboxesService

  beforeEach(async () => {
    ;({ client, service } = await prepareSandboxes())
  })

  const CLIENT_TOKEN = 'a'.repeat(64)
  const SERVE_URL = 'https://atlas-3000-abc.vercel.run'

  it('runningEndpoint answers from the registered row without probing Vercel', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
    })

    const endpoint = await service.runningEndpoint({ userId: USER_A, threadId: THREAD })

    expect(endpoint).toEqual({ token: CLIENT_TOKEN, url: SERVE_URL })
    expect(client.inspect).not.toHaveBeenCalled()
  })

  it('runningEndpoint falls back to the Vercel inspect for a pre-registration row', async () => {
    const attachment = await service.claim({ userId: USER_A, threadId: THREAD })
    client.inspect.mockResolvedValue({
      state: ESandboxState.Running,
      url: 'https://atlas-3000.vercel.run',
    })

    const endpoint = await service.runningEndpoint({ userId: USER_A, threadId: THREAD })

    expect(endpoint).toEqual({ token: attachment.token, url: 'https://atlas-3000.vercel.run' })
    expect(client.inspect).toHaveBeenCalled()
  })

  it('status answers running with the registered URL and no Vercel probe', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
    })

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Running)
    expect(status.url).toBe(SERVE_URL)
    expect(client.inspect).not.toHaveBeenCalled()
  })

  it('status reports the stored parked state for a registered row, withholding the endpoint', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
    })
    await db.orm.public.CloudSandbox.where({ threadId: THREAD }).update({
      state: ESandboxState.Parked,
    })

    const status = await service.status({ userId: USER_A, threadId: THREAD })

    expect(status.state).toBe(ESandboxState.Parked)
    expect(status.url).toBeUndefined()
    expect(client.inspect).not.toHaveBeenCalled()
  })

  it('runningEndpoint withholds the attach endpoint once a registered row is parked', async () => {
    await service.claim({
      userId: USER_A,
      threadId: THREAD,
      clientToken: CLIENT_TOKEN,
      serveUrl: SERVE_URL,
    })
    await db.orm.public.CloudSandbox.where({ threadId: THREAD }).update({
      state: ESandboxState.Parked,
    })

    expect(await service.runningEndpoint({ userId: USER_A, threadId: THREAD })).toBeNull()
    expect(client.inspect).not.toHaveBeenCalled()
  })

  it('runningEndpoint stops answering a legacy row once stop cleared its token', async () => {
    const attachment = await service.claim({ userId: USER_A, threadId: THREAD })
    await service.stop({ userId: USER_A, threadId: THREAD })

    expect(await service.runningEndpoint({ userId: USER_A, threadId: THREAD })).toBeNull()
    expect(attachment.token.length).toBeGreaterThan(0)
  })
})
