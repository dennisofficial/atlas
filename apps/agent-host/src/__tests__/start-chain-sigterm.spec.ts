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

const startStub = (env: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'start-chain-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { start: startScript() } }))
  symlinkSync(join(agentHostDir, 'node_modules'), join(dir, 'node_modules'))
  writeFileSync(join(dir, '.env.production.enc'), 'CHAIN_SPEC=1\n')
  const spawned = Bun.spawn({
    cmd: ['bun', 'run', 'start'],
    cwd: dir,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  })
  return spawned
}

type Reader = { read(): Promise<{ done: boolean; value?: Uint8Array | undefined }> }

const readUntil = async (reader: Reader, marker: string): Promise<string> => {
  let output = ''
  while (!output.includes(marker)) {
    const chunk = await reader.read()
    if (chunk.done || chunk.value === undefined) break
    output += new TextDecoder().decode(chunk.value)
  }
  return output
}

const drainOf = async (reader: Reader, output: string): Promise<string> => {
  let rest = output
  while (true) {
    const chunk = await reader.read()
    if (chunk.done || chunk.value === undefined) return rest
    rest += new TextDecoder().decode(chunk.value)
  }
}

describe('the production start chain on SIGTERM', () => {
  it('lets a drain longer than 5s finish and exits 0 when the whole process group is signalled', async () => {
    const spawned = startStub({ SLOW_DRAIN_MS: '7000', HARD_EXIT_MS: '60000' })
    const reader = spawned.stdout.getReader()
    const started = await readUntil(reader, 'ready')
    expect(started).toContain('ready')
    const startedAt = Date.now()
    process.kill(-spawned.pid, 'SIGTERM')
    const exitCode = await spawned.exited
    const elapsed = Date.now() - startedAt
    const output = await drainOf(reader, started)
    expect(output).toContain('draining')
    expect(output).toContain('drained')
    expect(exitCode).toBe(0)
    expect(elapsed).toBeGreaterThanOrEqual(7000)
  }, 30_000)

  it('hard exits 1 with a warning when the drain outlives the cap', async () => {
    const spawned = startStub({ SLOW_DRAIN_MS: '60000', HARD_EXIT_MS: '300' })
    const reader = spawned.stdout.getReader()
    const started = await readUntil(reader, 'ready')
    expect(started).toContain('ready')
    process.kill(-spawned.pid, 'SIGTERM')
    const exitCode = await spawned.exited
    const output = await drainOf(reader, started)
    expect(output).toContain('hard exit: the drain did not finish in 300ms')
    expect(output).not.toContain('drained')
    expect(exitCode).toBe(1)
  }, 30_000)
})
