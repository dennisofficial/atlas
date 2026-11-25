import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { callJournalOf, makeFifo, releaseFifo, waitForCallDone } from '../fault-support'

const journalOf = (args: {
  daemonHome: string
  runId: string
  callId: string
  state: 'running' | 'done'
}): string => {
  const path = callJournalOf(args)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ state: args.state }))
  return path
}

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

describe('waitForCallDone', () => {
  it('ignores another call that already finished in the same daemon home', async () => {
    const dir = tempDirOf()
    try {
      journalOf({ daemonHome: dir, runId: 'host-1', callId: 'prepare', state: 'done' })
      journalOf({ daemonHome: dir, runId: 'run-1', callId: 'c1', state: 'running' })
      await expect(
        waitForCallDone({ daemonHome: dir, runId: 'run-1', callId: 'c1', timeoutMs: 400 }),
      ).rejects.toThrow('no done journal at')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10_000)

  it('returns once that call finishes, not when a sibling finishes', async () => {
    const dir = tempDirOf()
    try {
      journalOf({ daemonHome: dir, runId: 'host-1', callId: 'prepare', state: 'done' })
      const own = journalOf({ daemonHome: dir, runId: 'run-1', callId: 'c1', state: 'running' })
      const finished = Bun.sleep(150).then(() =>
        writeFileSync(own, JSON.stringify({ state: 'done' })),
      )
      expect(
        await waitForCallDone({ daemonHome: dir, runId: 'run-1', callId: 'c1', timeoutMs: 5_000 }),
      ).toBe(own)
      await finished
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10_000)
})
