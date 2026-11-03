import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonTestEnv } from '../testing'

const entry = join(import.meta.dir, '../index.ts')

const startWithout = async (name: string): Promise<{ code: number | null; stderr: string }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-daemon-start-'))
  try {
    const env = { ...daemonTestEnv(home), [name]: undefined }
    const child = Bun.spawn({ cmd: ['bun', entry], env, stdout: 'pipe', stderr: 'pipe' })
    const code = await child.exited
    return { code, stderr: await new Response(child.stderr).text() }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('daemon startup', () => {
  for (const name of ['V2_DAEMON_SECRET', 'ATLAS_SANDBOX_NAME']) {
    it(`refuses to start without ${name}`, async () => {
      const { code, stderr } = await startWithout(name)
      expect(code).toBe(78)
      expect(stderr).toContain(name)
    })
  }
})
