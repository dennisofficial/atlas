import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-transport'
import { SandboxClient } from '../sandbox-client'

import { CLAIM_URL, harness } from './sandbox-client-fixture'

describe('claiming a sandbox', () => {
  it('posts the thread id, git token and context flag, and reads back the session token', async () => {
    const { client, calls } = harness([{ data: { token: 'tok_1' } }])

    const claim = await client.claimSandbox({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
    })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe(CLAIM_URL)
    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
    })
    expect(claim).toEqual({ token: 'tok_1' })
  })

  it('carries the workspace spec when a birth supplies one', async () => {
    const { client, calls } = harness([{ data: { token: 'tok_1' } }])
    const workspace = {
      remoteUrl: 'https://github.com/compai/atlas',
      branch: 'main',
      commit: 'abc123',
      patch: '',
      projectDirectory: '/code/atlas',
    }

    await client.claimSandbox({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
      workspace,
    })

    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
      workspace,
    })
  })

  it('passes a workspace carrying a git identity through to the claim body verbatim', async () => {
    const { client, calls } = harness([{ data: { token: 'tok_1' } }])
    const workspace = {
      remoteUrl: 'https://github.com/compai/atlas',
      branch: 'main',
      commit: 'abc123',
      patch: '',
      projectDirectory: '/code/atlas',
      gitIdentity: { name: 'Dennis Lysenko', email: 'dennis@comp.ai' },
    }

    await client.claimSandbox({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
      workspace,
    })

    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
      workspace,
    })
  })

  it('carries the bearer token and the client version', async () => {
    const { client, calls } = harness([{ data: { token: 'tok_1' } }])

    await client.claimSandbox({ threadId: 'brn_cloud', gitToken: 'gho_abc', contextPending: false })

    expect(calls[0]?.headers.get('authorization')).toBe('Bearer sess_test')
    expect(calls[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('refuses a response carrying no session token', async () => {
    const { client } = harness([{ data: { threadId: 'brn_cloud' } }])

    await expect(
      client.claimSandbox({ threadId: 'brn_cloud', gitToken: 'gho_abc', contextPending: true }),
    ).rejects.toThrow()
  })

  it('surfaces a failure as a CloudError carrying the status', async () => {
    const { client } = harness([{ status: 402, message: 'no sandbox entitlement' }])

    const failure = await client
      .claimSandbox({ threadId: 'brn_cloud', gitToken: 'gho_abc', contextPending: true })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(402)
    expect((failure as CloudError).message).toContain('no sandbox entitlement')
  })
})

describe('registering a client-provisioned sandbox', () => {
  const TOKEN = 'a'.repeat(64)

  it('posts the client token and serve URL to the claim route, and reads both back', async () => {
    const { client, calls } = harness([{ data: { token: TOKEN, url: 'https://box.vercel.run' } }])

    const registered = await client.registerSandbox({
      threadId: 'brn_cloud',
      token: TOKEN,
      serveUrl: 'https://box.vercel.run',
      metadata: { title: 'fix the flake', repo: 'compai/atlas', model: 'claude-opus-4-6' },
    })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe(CLAIM_URL)
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer sess_test')
    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      clientToken: TOKEN,
      serveUrl: 'https://box.vercel.run',
      metadata: { title: 'fix the flake', repo: 'compai/atlas', model: 'claude-opus-4-6' },
    })
    expect(registered).toEqual({ token: TOKEN, url: 'https://box.vercel.run' })
  })

  it('carries the serve version when the caller pins one', async () => {
    const { client, calls } = harness([{ data: { token: TOKEN } }])

    await client.registerSandbox({
      threadId: 'brn_cloud',
      token: TOKEN,
      serveUrl: 'https://box.vercel.run',
      serveVersion: '1.42.0',
    })

    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      clientToken: TOKEN,
      serveUrl: 'https://box.vercel.run',
      serveVersion: '1.42.0',
    })
  })

  it('omits the optional fields the caller did not pass', async () => {
    const { client, calls } = harness([{ data: { token: TOKEN } }])

    const registered = await client.registerSandbox({
      threadId: 'brn_cloud',
      token: TOKEN,
      serveUrl: 'https://box.vercel.run',
    })

    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      clientToken: TOKEN,
      serveUrl: 'https://box.vercel.run',
    })
    expect(registered.url).toBeUndefined()
  })

  it('refuses an answer carrying no token', async () => {
    const { client } = harness([{ data: { threadId: 'brn_cloud' } }])

    await expect(
      client.registerSandbox({
        threadId: 'brn_cloud',
        token: TOKEN,
        serveUrl: 'https://box.vercel.run',
      }),
    ).rejects.toThrow()
  })

  it('surfaces a refusal as a CloudError carrying the status', async () => {
    const { client } = harness([{ status: 400, message: 'serveUrl must use https' }])

    const failure = await client
      .registerSandbox({
        threadId: 'brn_cloud',
        token: TOKEN,
        serveUrl: 'http://box.vercel.run',
      })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(400)
    expect((failure as CloudError).message).toContain('serveUrl must use https')
  })

  it('rejects a wedged connection rather than waiting on it', async () => {
    const fetchFn = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timed out')))
      })) as typeof fetch
    const client = new SandboxClient({
      url: 'https://cloud.test/',
      token: 'sess_test',
      fetchFn,
    })

    const failure = await client
      .registerSandbox({
        threadId: 'brn_cloud',
        token: TOKEN,
        serveUrl: 'https://box.vercel.run',
      })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
  }, 15_000)
})
