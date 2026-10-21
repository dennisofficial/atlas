import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { markLineOf, markSourceAt, SERVE_MAIN_PATH } from '../rig-source-mark'

const ORIGINAL = Buffer.from("import { startServe } from './index'\r\nawait startServe()\n\u00e9")

const runGit = (args: { cwd: string; argv: readonly string[] }): void => {
  const proc = Bun.spawnSync({
    cmd: ['git', '-c', 'user.email=rig@example.com', '-c', 'user.name=rig', ...args.argv],
    cwd: args.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (proc.exitCode !== 0) throw new Error(`git ${args.argv.join(' ')}: ${proc.stderr.toString()}`)
}

describe('markSourceAt', () => {
  let repoRoot = ''
  let file = ''

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'rig-source-mark-'))
    file = join(repoRoot, SERVE_MAIN_PATH)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, ORIGINAL)
    runGit({ cwd: repoRoot, argv: ['init', '-q'] })
    runGit({ cwd: repoRoot, argv: ['add', '.'] })
    runGit({ cwd: repoRoot, argv: ['commit', '-q', '-m', 'seed'] })
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('appends the mark line after the original bytes', async () => {
    const marked = await markSourceAt({ repoRoot, mark: '0123456789abcdef' })

    const onDisk = await readFile(file)
    expect(onDisk.subarray(0, ORIGINAL.length).equals(ORIGINAL)).toBe(true)
    expect(onDisk.subarray(ORIGINAL.length).toString()).toBe(
      "\nprocess.env.ATLAS_RIG_MARK ??= '0123456789abcdef'\n",
    )
    expect(marked.repoRoot).toBe(repoRoot)
    await marked.restore()
  })

  test('generates a 16 hex mark when none is given', async () => {
    const marked = await markSourceAt({ repoRoot })

    expect(marked.mark).toMatch(/^[0-9a-f]{16}$/)
    expect((await readFile(file, 'utf8')).endsWith(markLineOf(marked.mark))).toBe(true)
    await marked.restore()
  })

  test('restore writes back the exact original bytes and is idempotent', async () => {
    const marked = await markSourceAt({ repoRoot })

    await marked.restore()
    expect((await readFile(file)).equals(ORIGINAL)).toBe(true)
    await writeFile(file, 'edited after restore')
    await marked.restore()
    expect(await readFile(file, 'utf8')).toBe('edited after restore')
  })

  test('registers signal handlers while marked and removes them on restore', async () => {
    const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') }
    const marked = await markSourceAt({ repoRoot })

    expect(process.listenerCount('SIGINT')).toBe(before.int + 1)
    expect(process.listenerCount('SIGTERM')).toBe(before.term + 1)
    await marked.restore()
    expect(process.listenerCount('SIGINT')).toBe(before.int)
    expect(process.listenerCount('SIGTERM')).toBe(before.term)
  })

  test('a SIGTERM restores the original bytes before the signal goes on', async () => {
    const handleKeepAlive = (): void => undefined
    process.on('SIGTERM', handleKeepAlive)
    try {
      const marked = await markSourceAt({ repoRoot })
      process.emit('SIGTERM', 'SIGTERM')
      await marked.restore()
      expect((await readFile(file)).equals(ORIGINAL)).toBe(true)
    } finally {
      process.off('SIGTERM', handleKeepAlive)
    }
  })

  test('refuses when main.ts already has uncommitted changes', async () => {
    await writeFile(file, 'someone else is editing this')
    const before = process.listenerCount('SIGINT')

    await expect(markSourceAt({ repoRoot })).rejects.toThrow(/uncommitted changes/)
    expect(await readFile(file, 'utf8')).toBe('someone else is editing this')
    expect(process.listenerCount('SIGINT')).toBe(before)
  })
})
