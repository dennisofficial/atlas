import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'bun:test'

import { attachDurableShell, launchDurableShell } from '../client'
import { collect } from './fixture'

const binary = process.env.ATLAS_SUPERVISOR_TEST_BINARY
const testBinary = binary === undefined ? it.skip : it

testBinary('the compiled app supervises and reconnects without Bun on PATH or normal app boot', async () => {
  if (binary === undefined) throw new Error('a compiled binary is required')
  const root = await mkdtemp(join(tmpdir(), 'atlas-compiled-supervisor-'))
  const shellDir = join(root, 'shell')
  const launched = await launchDurableShell({
    shellDir,
    command: 'printf "compiled-ready\\n"; read answer; printf "reply:%s\\n" "$answer"; exit 7',
    cwd: root,
    env: { PATH: '/usr/bin:/bin', ATLAS_HOME: join(root, 'home') },
    supervisorCommand: [binary, '--shell-supervise'],
    pollMs: 20,
    tickMs: 50,
  })
  try {
    if (!launched.ok) throw new Error(launched.reason)
    await launched.handle.detach()
    const attached = await attachDurableShell({ shellDir, pollMs: 20 })
    if (!attached.ok) throw new Error(attached.reason)
    try {
      expect((await attached.handle.writeInput('after-restart\n')).ok).toBe(true)
      const output = await collect({ stream: attached.handle.stdout })
      expect(output).toBe('compiled-ready\nreply:after-restart\n')
      expect(await attached.handle.exited).toBe(7)
      const status = await attached.handle.status()
      expect(status?.exit?.exitCode).toBe(7)
    } finally {
      await attached.handle.kill()
      await attached.handle.detach()
    }
  } finally {
    if (launched.ok) await launched.handle.kill()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)
