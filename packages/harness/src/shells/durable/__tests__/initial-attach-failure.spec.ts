import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'bun:test'

import { EControlError, EShellPhase, launchDurableShell, sendControl } from '../client'
import { readStatus } from '../handle'

for (const throws of [false, true]) {
  it(`cancels its owned command when initial attachment ${throws ? 'throws' : 'is refused'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-attach-failure-'))
    const shellDir = join(root, 'shell')
    try {
      const launched = await launchDurableShell({
        shellDir,
        command: 'sleep 300',
        cwd: root,
        tickMs: 50,
        killGraceMs: 100,
        transport: async () => {
          if (throws) throw new Error('the router lost its connection')
          return { ok: false, code: EControlError.Unreachable, message: 'the router is temporarily unreachable' }
        },
      })
      expect(launched.ok).toBe(false)
      expect(await Bun.file(join(shellDir, 'cancel')).exists()).toBe(true)
      const until = Date.now() + 5_000
      let status = await readStatus({ shellDir })
      while (status?.exit === undefined && Date.now() < until) {
        await Bun.sleep(20)
        status = await readStatus({ shellDir })
      }
      expect(status?.exit).toBeDefined()
      expect(status?.phase).toBe(EShellPhase.Exited)
    } finally {
      await sendControl({ directory: shellDir, request: { type: 'kill' }, timeoutMs: 300 })
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
}
