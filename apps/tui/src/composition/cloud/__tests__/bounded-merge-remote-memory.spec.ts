import { beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { currentNotices, dismissNotice } from '../../../ui/notice-store'
import { mergeRemoteMemoryBounded } from '../bounded-merge-remote-memory'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const SESSION = { url: 'https://cloud.test', token: 'sess_test' }

beforeEach(() => {
  dismissNotice()
})

describe('mergeRemoteMemoryBounded', () => {
  it('resolves promptly and silently when the control plane never answers', async () => {
    const cwd = await freshDirectory('atlas-bounded-merge-cwd-')
    const fetchFn = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch

    const startedAt = Date.now()
    await mergeRemoteMemoryBounded({ session: SESSION, cwd, timeoutMs: 20, fetchFn })
    const elapsedMs = Date.now() - startedAt

    expect(elapsedMs).toBeLessThan(1_000)
    expect(currentNotices()).toHaveLength(0)
  })

  it('resolves without a notice when the merge finishes inside the bound', async () => {
    const cwd = await freshDirectory('atlas-bounded-merge-cwd-')
    const fetchFn = (async (_input: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ bundle: null }), { status: 200 })) as typeof fetch

    await mergeRemoteMemoryBounded({ session: SESSION, cwd, timeoutMs: 5_000, fetchFn })

    expect(currentNotices()).toHaveLength(0)
  })

  it('never rejects, even when the underlying fetch throws outright', async () => {
    const cwd = await freshDirectory('atlas-bounded-merge-cwd-')
    const fetchFn = (async (_input: unknown, _init?: RequestInit): Promise<Response> => {
      throw new Error('network unreachable')
    }) as typeof fetch

    await expect(
      mergeRemoteMemoryBounded({ session: SESSION, cwd, timeoutMs: 5_000, fetchFn }),
    ).resolves.toBeUndefined()
  })
})
