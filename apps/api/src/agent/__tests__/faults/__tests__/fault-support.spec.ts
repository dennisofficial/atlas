import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { makeFifo, releaseFifo } from '../fault-support'

const tempDirOf = (): string => mkdtempSync(join(tmpdir(), 'atlas-fault-support-'))

describe('releaseFifo', () => {
  it('releases a gate whose reader opens only after the release call', async () => {
    const dir = tempDirOf()
    const gate = join(dir, 'gate')
    const out = join(dir, 'out')
    makeFifo({ path: gate })
    const reader = Bun.spawn({
      cmd: ['sh', '-c', `sleep 0.25; cat '${gate}' > '${out}'`],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    })
    try {
      await releaseFifo({ path: gate, timeoutMs: 5_000 })
      await reader.exited
      expect(readFileSync(out, 'utf8')).toBe('go\n')
    } finally {
      reader.kill('SIGKILL')
      await reader.exited.catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10_000)

  it('reports a gate that no reader opens instead of returning silently', async () => {
    const dir = tempDirOf()
    const gate = join(dir, 'gate')
    makeFifo({ path: gate })
    try {
      await expect(releaseFifo({ path: gate, timeoutMs: 300 })).rejects.toThrow(
        'timed out releasing',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10_000)
})
