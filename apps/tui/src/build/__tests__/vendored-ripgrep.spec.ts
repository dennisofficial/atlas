import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { stageVendoredRipgrep } from '../../../scripts/stage-ripgrep'

const runCapturing = async (args: {
  command: readonly string[]
  cwd: string
}): Promise<{ code: number; stdout: string; stderr: string }> => {
  const spawned = Bun.spawn([...args.command], {
    cwd: args.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(spawned.stdout).text(),
    new Response(spawned.stderr).text(),
    spawned.exited,
  ])

  return { code, stdout, stderr }
}

describe('vendored ripgrep in a compiled binary', () => {
  it('materializes the embedded binary and runs it', async () => {
    const tuiRoot = join(import.meta.dir, '..', '..', '..')
    const repoRoot = join(tuiRoot, '..', '..')
    const binary = join(mkdtempSync(join(tmpdir(), 'atlas-vendored-rg-')), 'probe')

    await stageVendoredRipgrep({ repoRoot, target: undefined })

    const built = await runCapturing({
      cwd: tuiRoot,
      command: ['bun', 'build', '--compile', join(import.meta.dir, 'vendored-ripgrep-entry.ts'), '--outfile', binary],
    })

    expect(built.stderr).not.toContain('error:')
    expect(built.code).toBe(0)

    const ran = await runCapturing({ cwd: tuiRoot, command: [binary] })

    expect(ran.stderr).toBe('')
    expect(ran.code).toBe(0)

    const reported: unknown = JSON.parse(ran.stdout)
    expect(reported).toMatchObject({
      exitCode: 0,
      firstLine: expect.stringMatching(/^ripgrep \d+\./),
    })
    const resolved = (reported as { resolved: string | null }).resolved
    expect(resolved).not.toBeNull()
    expect(resolved).not.toContain('node_modules')
  }, 180_000)
})
