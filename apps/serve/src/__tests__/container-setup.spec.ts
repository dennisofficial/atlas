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
const CONFIG = `${CWD}/.atlas/container.json`
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
  const env: Record<string, string | undefined> = {}
  const apply = (setupScript?: string | null) =>
    createContainerSetup({ files, run })({
      cwd: CWD,
      atlasHome: HOME,
      env,
      setupScript,
      notice: { notify: (post) => void posts.push(post) },
    })
  return { apply, attempts, posts, env, contents }
}

const json = (value: unknown): Record<string, string> => ({
  [CONFIG]: JSON.stringify(value),
})

describe('cloud container.json application', () => {
  it('runs setup once, then start on every boot', async () => {
    const h = harness({
      contents: json({ setup: 'bun install', start: 'redis-server -d' }),
    })

    await h.apply()
    await h.apply()

    expect(h.attempts.map((a) => a.command)).toEqual([
      ['sh', '-c', 'bun install'],
      ['sh', '-c', 'redis-server -d'],
      ['sh', '-c', 'redis-server -d'],
    ])
    expect(h.attempts.every((a) => a.cwd === CWD)).toBe(true)
    expect(h.contents.has(MARKER)).toBe(true)
  })

  it('exports env to the serve process and to the scripts', async () => {
    const h = harness({ contents: json({ setup: 'x', env: { FOO: 'bar' } }) })

    await h.apply()

    expect(h.env.FOO).toBe('bar')
    expect(h.attempts[0]?.env?.FOO).toBe('bar')
  })

  it('lets a non-empty project setup script replace container.json setup', async () => {
    const h = harness({ contents: json({ setup: 'from-json' }) })

    await h.apply('  make deps  ')

    expect(h.attempts.map((a) => a.command[2])).toEqual(['make deps'])
  })

  it('runs the project setup script without a container.json', async () => {
    const h = harness({})

    await h.apply('npm ci')

    expect(h.attempts.map((a) => a.command[2])).toEqual(['npm ci'])
  })

  it('ignores an empty project setup script', async () => {
    const h = harness({ contents: json({ setup: 'from-json' }) })

    await h.apply('   ')

    expect(h.attempts.map((a) => a.command[2])).toEqual(['from-json'])
  })

  it('does nothing without any configuration', async () => {
    const h = harness({})

    await h.apply(null)

    expect(h.attempts).toEqual([])
    expect(h.posts).toEqual([])
  })

  it('posts one notice when image, dockerfile or mounts cannot apply', async () => {
    const h = harness({
      contents: json({
        image: 'node:22',
        mounts: [{ path: '/data' }],
        setup: 'true',
      }),
    })

    await h.apply()

    expect(h.posts).toHaveLength(1)
    expect(h.posts[0]?.tone).toBe(ENoticeTone.Warn)
    expect(h.posts[0]?.text).toContain('not applied in Cloud sandboxes')
    expect(h.posts[0]?.text).toContain('image')
    expect(h.posts[0]?.text).toContain('mounts')
  })

  it('surfaces a failed setup with the last 2000 characters and retries next boot', async () => {
    const output = `${'a'.repeat(3000)}TAIL`
    const h = harness({
      contents: json({ setup: 'boom' }),
      fail: () => output,
    })

    await h.apply()

    const post = h.posts.find((p) => p.text.includes('setup script'))
    expect(post?.tone).toBe(ENoticeTone.Warn)
    expect(post?.ttlMs).toBeNull()
    expect(post?.text.endsWith('TAIL')).toBe(true)
    expect(post?.text.length).toBeLessThan(2300)
    expect(h.contents.has(MARKER)).toBe(false)
  })

  it('surfaces a failed start without blocking the boot', async () => {
    const h = harness({
      contents: json({ start: 'bad' }),
      fail: (script) => (script === 'bad' ? 'nope' : undefined),
    })

    await h.apply()

    expect(h.posts.some((p) => p.text.includes('start script') && p.text.includes('nope'))).toBe(
      true,
    )
  })

  it('surfaces an unparseable container.json', async () => {
    const h = harness({ contents: { [CONFIG]: '{ nope' } })

    await h.apply('echo hi')

    expect(h.posts.some((p) => p.text.includes('container.json'))).toBe(true)
    expect(h.attempts.map((a) => a.command[2])).toEqual(['echo hi'])
  })

  it('returns None, Ran, Skipped and Failed', async () => {
    expect(await harness({}).apply()).toBe(EContainerSetupResult.None)
    const ran = harness({ contents: json({ setup: 'x' }) })
    expect(await ran.apply()).toBe(EContainerSetupResult.Ran)
    expect(await ran.apply()).toBe(EContainerSetupResult.Skipped)
    const failed = harness({ contents: json({ setup: 'x' }), fail: () => 'no' })
    expect(await failed.apply()).toBe(EContainerSetupResult.Failed)
  })

  it('names the script, its source, and that the sandbox started anyway', async () => {
    const h = harness({
      contents: json({ setup: 'a', start: 'b' }),
      fail: (script) => (script === 'a' ? 'oops' : undefined),
    })

    await h.apply()
    const text = h.posts.find((p) => p.ttlMs === null)?.text ?? ''

    expect(text).toContain('setup script (.atlas/container.json "setup")')
    expect(text).toContain('sandbox started anyway')
    expect(text).toContain('start script was skipped')
    expect(text.endsWith('oops')).toBe(true)
    expect(h.attempts.map((a) => a.command[2])).toEqual(['a'])
  })

  it('names project settings when the override fails', async () => {
    const h = harness({ fail: () => 'bad' })

    await h.apply('npm ci')

    expect(h.posts[0]?.text).toContain('setup script (project settings)')
  })

  it('passes the 15 minute cap to scripts and never throws', async () => {
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
    })({ cwd: CWD, atlasHome: HOME, env: {}, setupScript: 'x', notice: { notify: () => {} } })

    expect(seen).toEqual([15 * 60_000])
    expect(result).toBe(EContainerSetupResult.Failed)
  })
})
