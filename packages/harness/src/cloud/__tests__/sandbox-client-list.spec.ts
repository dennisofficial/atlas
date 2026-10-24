import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-transport'
import { ECloudSandboxState } from '../sandbox-client'
import { harness } from './sandbox-client-fixture'

describe('listing sandboxes', () => {
  it('gets the sandboxes route and parses each entry', async () => {
    const { client, calls } = harness([
      {
        data: [
          {
            threadId: 'brn_one',
            name: 'fix the thing',
            driveName: 'atlas',
            state: 'running',
            lastActivityAt: '2026-09-26T10:00:00.000Z',
          },
          {
            threadId: 'brn_two',
            name: 'parked work',
            driveName: null,
            state: 'parked',
            lastActivityAt: '2026-09-25T08:30:00.000Z',
          },
        ],
      },
    ])

    const sandboxes = await client.listSandboxes()

    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/trpc/sandboxes.list')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer sess_test')
    expect(sandboxes).toEqual([
      {
        threadId: 'brn_one',
        name: 'fix the thing',
        driveName: 'atlas',
        state: ECloudSandboxState.Running,
        lastActivityAt: '2026-09-26T10:00:00.000Z',
      },
      {
        threadId: 'brn_two',
        name: 'parked work',
        driveName: null,
        state: ECloudSandboxState.Parked,
        lastActivityAt: '2026-09-25T08:30:00.000Z',
      },
    ])
  })

  it('answers an empty list when the operator has no sandboxes', async () => {
    const { client } = harness([{ data: [] }])

    expect(await client.listSandboxes()).toEqual([])
  })

  it('refuses an entry whose state is not a known sandbox state', async () => {
    const { client } = harness([
      {
        data: [
          {
            threadId: 'brn_one',
            name: 'fix the thing',
            driveName: null,
            state: 'exploded',
            lastActivityAt: '2026-09-26T10:00:00.000Z',
          },
        ],
      },
    ])

    await expect(client.listSandboxes()).rejects.toThrow()
  })

  it('surfaces a transport failure as a CloudError carrying the status', async () => {
    const { client } = harness([{ status: 401, message: 'session expired' }])

    const failure = await client.listSandboxes().catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(401)
    expect((failure as CloudError).message).toContain('session expired')
  })
})

describe('destroying a sandbox', () => {
  it('posts the thread to sandboxes.destroy and answers nothing', async () => {
    const { client, calls } = harness([{}])

    expect(await client.destroySandbox({ threadId: 'brn_cloud' })).toBeUndefined()
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/trpc/sandboxes.destroy')
    expect(calls[0]?.body).toEqual({ threadId: 'brn_cloud' })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer sess_test')
  })

  it('treats a sandbox already gone as success rather than a failure', async () => {
    const { client } = harness([{ status: 404, message: 'not found' }])

    expect(await client.destroySandbox({ threadId: 'brn_cloud' })).toBeUndefined()
  })

  it('surfaces any other failure as a CloudError', async () => {
    const { client } = harness([{ status: 500, message: 'vercel said no' }])

    await expect(client.destroySandbox({ threadId: 'brn_cloud' })).rejects.toBeInstanceOf(
      CloudError,
    )
  })
})
