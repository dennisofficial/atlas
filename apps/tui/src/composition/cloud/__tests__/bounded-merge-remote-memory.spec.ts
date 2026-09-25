import { describe, expect, it } from 'bun:test'

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mergeRemoteMemoryBounded } from '@dltech/atlas-harness'

import { recordingNotices } from './merge-memory-fixture'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const SESSION = { url: 'https://cloud.test', token: 'sess_test' }

describe('mergeRemoteMemoryBounded', () => {
  it('resolves promptly and silently when the control plane never answers', async () => {
    const cwd = await freshDirectory('atlas-bounded-merge-cwd-')
    const fetchFn = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch

    const { posts, port } = recordingNotices()
    const startedAt = Date.now()
    await mergeRemoteMemoryBounded({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: port,
      cwd,
      timeoutMs: 20,
      fetchFn,
    })
    const elapsedMs = Date.now() - startedAt

    expect(elapsedMs).toBeLessThan(1_000)
    expect(posts).toHaveLength(0)
  })

  it('resolves without a notice when the merge finishes inside the bound', async () => {
    const cwd = await freshDirectory('atlas-bounded-merge-cwd-')
    const fetchFn = (async (_input: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ bundle: null }), { status: 200 })) as typeof fetch
    const { posts, port } = recordingNotices()

    await mergeRemoteMemoryBounded({
      session: SESSION,
      clientVersion: 'atlas/test',
      notice: port,
      cwd,
      timeoutMs: 5_000,
      fetchFn,
    })

    expect(posts).toHaveLength(0)
  })

  it('never rejects, even when the underlying fetch throws outright', async () => {
    const cwd = await freshDirectory('atlas-bounded-merge-cwd-')
    const fetchFn = (async (_input: unknown, _init?: RequestInit): Promise<Response> => {
      throw new Error('network unreachable')
    }) as typeof fetch

    await expect(
      mergeRemoteMemoryBounded({
        session: SESSION,
        clientVersion: 'atlas/test',
        notice: recordingNotices().port,
        cwd,
        timeoutMs: 5_000,
        fetchFn,
      }),
    ).resolves.toEqual({ replaced: 0, conflicts: [] })
  })
})
