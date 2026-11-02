import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  clonePrefetchScript,
  clonePrefetchWaitScript,
  parseClonePrefetchResult,
} from '../sandbox-clone-prefetch.js'

const input = {
  remoteUrl: 'https://github.com/acme/app.git',
  credentialedUrl: 'https://x-access-token:gho_secret@github.com/acme/app.git',
  baseBranch: 'develop' as string | null,
}

const parses = async (script: string): Promise<number> => {
  const spawned = Bun.spawn(['sh', '-n', '-c', script], { stdout: 'ignore', stderr: 'ignore' })
  return spawned.exited
}

describe('clonePrefetchScript', () => {
  it('locks, clones blobless on the branch, disarms the remote and publishes the result', () => {
    const script = clonePrefetchScript(input)
    expect(script).toContain('flock 9')
    expect(script).toContain('--filter=blob:none')
    expect(script).toContain("--branch 'develop'")
    expect(script).toContain("remote set-url origin 'https://github.com/acme/app.git'")
    expect(script).toContain('result.json')
  })

  it('omits the branch flag without a base branch', () => {
    expect(clonePrefetchScript({ ...input, baseBranch: null })).not.toContain('--branch')
  })

  it('never echoes the token', () => {
    const lines = clonePrefetchScript(input)
      .split('\n')
      .filter((line) => /echo|printf/.test(line))
    expect(lines.some((line) => line.includes('gho_secret'))).toBe(false)
  })

  it('parses as sh', async () => {
    expect(await parses(clonePrefetchScript(input))).toBe(0)
    expect(await parses(clonePrefetchScript({ ...input, baseBranch: "it's" }))).toBe(0)
    expect(await parses(clonePrefetchWaitScript())).toBe(0)
  })

  it('records a scrubbed failure when the clone fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prefetch-'))
    try {
      const script = clonePrefetchScript({
        remoteUrl: 'https://github.com/acme/app.git',
        credentialedUrl: 'https://x-access-token:gho_secret@127.0.0.1:1/none.git',
        baseBranch: null,
      }).replaceAll('/atlas/home/operational/clone-prefetch', dir)
      const run = Bun.spawn(['sh', '-c', script], { stdout: 'ignore', stderr: 'ignore' })
      await run.exited
      const result = await readFile(join(dir, 'result.json'), 'utf8')
      expect(parseClonePrefetchResult(result)).toMatchObject({ ok: false })
      expect(result).not.toContain('gho_secret')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('parseClonePrefetchResult', () => {
  it('reads ok and failure shapes and rejects garbage', () => {
    expect(parseClonePrefetchResult('{"ok":true}')).toEqual({ ok: true })
    expect(parseClonePrefetchResult('{"ok":false,"reason":"nope"}')).toEqual({
      ok: false,
      reason: 'nope',
    })
    expect(parseClonePrefetchResult('')).toBeUndefined()
  })
})
