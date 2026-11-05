import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

const agentHostDir = join(import.meta.dir, '../..')
const stubMain = join(import.meta.dir, 'support/slow-drain-main.ts')

const startScript = (): string => {
  const manifest = JSON.parse(readFileSync(join(agentHostDir, 'package.json'), 'utf8')) as {
    scripts: { start: string }
  }
  return manifest.scripts.start
    .replace('./src/', `${agentHostDir}/src/`)
    .replace('src/main.ts', stubMain)
}

describe('the production start chain on SIGTERM', () => {
  it('lets a drain longer than 5s finish and exits 0 when the whole process group is signalled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'start-chain-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { start: startScript() } }))
    symlinkSync(join(agentHostDir, 'node_modules'), join(dir, 'node_modules'))
    writeFileSync(join(dir, '.env.production.enc'), 'CHAIN_SPEC=1\n')
    const spawned = Bun.spawn({
      cmd: ['bun', 'run', 'start'],
      cwd: dir,
      env: { ...process.env, SLOW_DRAIN_MS: '7000' },
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    })
    const reader = spawned.stdout.getReader()
    let output = ''
    while (!output.includes('ready')) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += new TextDecoder().decode(chunk.value)
    }
    expect(output).toContain('ready')
    const startedAt = Date.now()
    process.kill(-spawned.pid, 'SIGTERM')
    const exitCode = await spawned.exited
    const elapsed = Date.now() - startedAt
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += new TextDecoder().decode(chunk.value)
    }
    expect(output).toContain('drained')
    expect(exitCode).toBe(0)
    expect(elapsed).toBeGreaterThanOrEqual(7000)
  }, 30_000)
})
