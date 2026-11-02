import { describe, expect, it } from 'bun:test'

import { runCommand } from '../run-command'

describe('runCommand timeout', () => {
  it('kills a hanging command and reports the timeout with output so far', async () => {
    const started = Date.now()
    const run = await runCommand({
      command: ['sh', '-c', 'echo partial; sleep 30'],
      cwd: process.cwd(),
      timeoutMs: 300,
    })

    expect(run.ok).toBe(false)
    expect(run.stdout).toContain('partial')
    expect(run.stderr).toContain('timed out after')
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('returns normally within the cap', async () => {
    const run = await runCommand({
      command: ['sh', '-c', 'echo hi'],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    })

    expect(run).toEqual({ ok: true, stdout: 'hi\n', stderr: '' })
  })
})
