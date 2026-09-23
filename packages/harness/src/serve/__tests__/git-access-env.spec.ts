import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { fakeServeApp } from './fakes'

const TOKEN = 'session-token'

const threadId = toThreadId('thread-serve')

const CONTROL_PLANE = 'https://api.example.com'

const running: ServeHandle[] = []

const inMemoryContextFiles = (): WorkspaceFiles => {
  const stored = new Map<string, string>()
  return {
    exists: async (path) => stored.has(path),
    read: async (path) => {
      const text = stored.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => {
      stored.set(path, text)
    },
    writeBytes: async ({ path, bytes }) => {
      stored.set(path, bytes.toString('utf8'))
    },
    empty: async () => undefined,
  }
}

const specResponse = (githubToken: string | null): Response =>
  Response.json({
    remoteUrl: 'https://github.com/dennisofficial/atlas.git',
    branch: 'main',
    commit: null,
    patch: '',
    githubToken,
  })

const fetchFnFor = (workspace: () => Response): typeof fetch =>
  (async (input: unknown) => {
    const url = String(input)
    if (url.endsWith('/workspace')) return workspace()
    return new Response(null, { status: 204 })
  }) as typeof fetch

const start = async (args: {
  env: Record<string, string | undefined>
  fetchFn: typeof fetch
}): Promise<ServeHandle> => {
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: args.env,
    cwd: '/workspace',
    compose: async () => app,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: args.fetchFn,
    contextFiles: inMemoryContextFiles(),
  })
  running.push(handle)
  return handle
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close()
})

describe('serve git access env', () => {
  it('arms GH_TOKEN and the git config entries when the workspace spec carries a token', async () => {
    const env: Record<string, string | undefined> = {}

    await start({ env, fetchFn: fetchFnFor(() => specResponse('gho_cloud')) })

    expect(env.GH_TOKEN).toBe('gho_cloud')
    expect(env.GIT_CONFIG_COUNT).toBe('7')
    expect(env.GIT_CONFIG_KEY_1).toBe('safe.directory')
    expect(env.GIT_CONFIG_VALUE_1).toBe('/workspace')
    expect(env.GIT_CONFIG_KEY_3).toBe('credential.helper')
    expect(env.GIT_CONFIG_VALUE_3).toBe('')
    expect(env.GIT_CONFIG_KEY_4).toBe('credential.https://github.com.helper')
    expect(env.GIT_CONFIG_VALUE_4).toBe('!gh auth git-credential')
    expect(env.GIT_CONFIG_KEY_5).toBe('url.https://github.com/.insteadOf')
    expect(env.GIT_CONFIG_VALUE_5).toBe('git@github.com:')
  })

  it('leaves the environment alone when the spec carries no token', async () => {
    const env: Record<string, string | undefined> = {}

    await start({ env, fetchFn: fetchFnFor(() => specResponse(null)) })

    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.GIT_CONFIG_COUNT).toBeUndefined()
  })

  it('boots without git access when the workspace spec cannot be fetched', async () => {
    const env: Record<string, string | undefined> = {}

    const handle = await start({
      env,
      fetchFn: fetchFnFor(() => new Response('gone', { status: 400 })),
    })

    const health = await fetch(`http://127.0.0.1:${handle.port}/v1/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(health.status).toBe(200)
    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.GIT_CONFIG_COUNT).toBeUndefined()
  })
})
