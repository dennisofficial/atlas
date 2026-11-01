import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLogLine } from '../serve-log'
import { bindServeWriteBehind } from '../serve-write-behind'

import { fakeServeApp } from './fakes'
import { trpcFailure, trpcOk, trpcProcedureOf } from './trpc-fake'
import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-rename')
const controlPlaneUrl = 'https://api.example.com'
const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const bind = (args: { env: Record<string, string>; reject?: boolean }) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-rename-'))
  homes.push(home)
  const store = scratchTranscriptStore({ prefix: 'rename', home })
  const app = fakeServeApp({ threadId, root: '/workspace', intake: true, log: store.log })
  const posts: { procedure: string; body: unknown }[] = []
  const lines: ServeLogLine[] = []
  const behind = bindServeWriteBehind({
    redeliver: async () => undefined,
    env: args.env,
    app,
    threadId,
    durableHead: 0,
    remote: {
      controlPlaneUrl,
      token: 'serve-token',
      clientVersion: 'dev',
      fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
        const procedure = trpcProcedureOf(String(input))
        if (procedure !== 'threads.rename') return trpcOk({ head: 0 })
        posts.push({ procedure, body: JSON.parse(String(init?.body)) })
        return args.reject ? trpcFailure({ status: 500 }) : trpcOk(null)
      }) as unknown as typeof fetch,
    },
    log: (line) => lines.push(line),
  })
  return { app, behind, posts, lines }
}

const eventually = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the condition never held')
}

describe('forwarding thread renames to the API', () => {
  it('posts the renamed thread to threads.rename when api-provisioned', async () => {
    const { app, posts } = bind({ env: { [API_PROVISIONED_ENV]: '1' } })
    await app.threads.rename({ threadId, title: 'Fix the login bug' })
    await eventually(() => posts.length === 1)
    expect(posts[0]).toEqual({
      procedure: 'threads.rename',
      body: { threadId, title: 'Fix the login bug' },
    })
  })

  it('binds nothing without ATLAS_API_PROVISIONED', async () => {
    const { app, behind, posts } = bind({ env: {} })
    await app.threads.rename({ threadId, title: 'ignored' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(behind).toBeUndefined()
    expect(posts).toEqual([])
  })

  it('logs a rejected request and does not throw', async () => {
    const { app, lines } = bind({ env: { [API_PROVISIONED_ENV]: '1' }, reject: true })
    await app.threads.rename({ threadId, title: 'doomed' })
    await eventually(() => lines.some((line) => line.event === EServeEvent.RenameForwardFailed))
    const failed = lines.find((line) => line.event === EServeEvent.RenameForwardFailed)
    expect(failed?.threadId).toBe(threadId)
  })

  it('stops forwarding after detach', async () => {
    const { app, behind, posts } = bind({ env: { [API_PROVISIONED_ENV]: '1' } })
    behind?.detach()
    await app.threads.rename({ threadId, title: 'late' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(posts).toEqual([])
  })
})
