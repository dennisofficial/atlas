import { describe, expect, it } from 'bun:test'

import { ENoticeTone, type NoticePost } from '@dltech/atlas-core'

import {
  CONTAINER_SETUP_MARKER,
  createContainerSetup,
  EContainerSetupResult,
} from '../container-setup'
import type { CommandRunner } from '../run-command'
import type { WorkspaceFiles } from '../workspace-files'

const CWD = '/atlas/workspaces/repo'
const HOME = '/atlas/home'
const MARKER = `${HOME}/${CONTAINER_SETUP_MARKER}`

type Attempt = {
  command: readonly string[]
  cwd: string
  env?: Record<string, string> | undefined
}

const harness = (args: {
  contents?: Record<string, string>
  fail?: (script: string) => string | undefined
}) => {
  const contents = new Map(Object.entries(args.contents ?? {}))
  const files: WorkspaceFiles = {
    exists: async (path) => contents.has(path),
    read: async (path) => {
      const text = contents.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => void contents.set(path, text),
    writeBytes: async () => undefined,
    ensureDirectory: async () => undefined,
    empty: async () => undefined,
  }
  const attempts: Attempt[] = []
  const run: CommandRunner = async (attempt) => {
    attempts.push(attempt)
    const failure = args.fail?.(attempt.command[2] ?? '')
    if (failure !== undefined) return { ok: false, stdout: '', stderr: failure }
    return { ok: true, stdout: '', stderr: '' }
  }
  const posts: NoticePost[] = []
  const apply = (setupScript?: string | null) =>
    createContainerSetup({ files, run })({
      cwd: CWD,
      atlasHome: HOME,
      setupScript,
      notice: { notify: (post) => void posts.push(post) },
    })
  return { apply, attempts, posts, contents }
}

describe('cloud project setup script', () => {
  it('runs the project setup script once per sandbox', async () => {
    const h = harness({})

    await h.apply('bun install')
    await h.apply('bun install')

    expect(h.attempts.map((a) => a.command)).toEqual([['sh', '-c', 'bun install']])
    expect(h.attempts[0]?.cwd).toBe(CWD)
    expect(h.contents.has(MARKER)).toBe(true)
  })

  it('does nothing without a setup script', async () => {
    const h = harness({})

    expect(await h.apply(null)).toBe(EContainerSetupResult.None)
    expect(await h.apply('   ')).toBe(EContainerSetupResult.None)
    expect(h.attempts).toEqual([])
    expect(h.posts).toEqual([])
  })

  it('surfaces a failed setup with the last 2000 characters and retries next boot', async () => {
    const output = `${'a'.repeat(3000)}TAIL`
    const h = harness({ fail: () => output })

    const result = await h.apply('boom')

    expect(result).toBe(EContainerSetupResult.Failed)
    const post = h.posts[0]
    expect(post?.tone).toBe(ENoticeTone.Warn)
    expect(post?.ttlMs).toBeNull()
    expect(post?.text).toContain('setup script failed')
    expect(post?.text).toContain('sandbox started anyway')
    expect(post?.text.endsWith('TAIL')).toBe(true)
    expect(post?.text.length).toBeLessThan(2300)
    expect(h.contents.has(MARKER)).toBe(false)
  })

  it('passes the 15 minute cap to the script and never throws', async () => {
    const seen: (number | undefined)[] = []
    const result = await createContainerSetup({
      files: {
        exists: async () => false,
        read: async () => '',
        write: async () => undefined,
        writeBytes: async () => undefined,
        ensureDirectory: async () => undefined,
        empty: async () => undefined,
      },
      run: async (attempt) => {
        seen.push(attempt.timeoutMs)
        throw new Error('runner exploded')
      },
    })({ cwd: CWD, atlasHome: HOME, setupScript: 'x', notice: { notify: () => {} } })

    expect(seen).toEqual([15 * 60_000])
    expect(result).toBe(EContainerSetupResult.Failed)
  })
})
