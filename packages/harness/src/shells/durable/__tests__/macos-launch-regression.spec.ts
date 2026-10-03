import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { prepareSupervisorLauncher } from '../../supervisor-launch'
import { launchDurableShell } from '../client'
import { collect, scratchDirectory } from './fixture'

test('the supervisor boots independently of the shell storage directory and preserves the requested command cwd', async () => {
  const scratch = await scratchDirectory()
  try {
    const outcome = await launchDurableShell({
      shellDir: scratch.shellDir,
      cwd: scratch.shellDir,
      command: 'printf "%s\\n" "$PWD"; exit 7',
      startTimeoutMs: 2000,
      pollMs: 20,
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(await outcome.handle.exited).toBe(7)
    expect(await collect({ stream: outcome.handle.stdout })).toBe(`${await realpath(scratch.shellDir)}\n`)
  } finally {
    await scratch.cleanup()
  }
})

test('the portable source launcher receives a neutral boot cwd through the injected process port', async () => {
  const home = await mkdtemp('/tmp/atlas-launch-regression-')
  const scratch = await scratchDirectory()
  try {
    const launcher = await prepareSupervisorLauncher({ home, embedded: false })
    const outcome = await launchDurableShell({
      shellDir: scratch.shellDir,
      cwd: tmpdir(),
      command: 'echo portable; exit 9',
      supervisorCommand: launcher.host,
      startTimeoutMs: 2000,
      pollMs: 20,
      launch: async (spec) => {
        expect(spec.cwd).toBe('/')
        const [executable, ...rest] = spec.cmd
        if (executable === undefined) throw new Error('missing executable')
        const child = spawn(executable, rest, { detached: true, stdio: 'ignore', cwd: spec.cwd, env: spec.env })
        child.unref()
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.once('spawn', resolve)
        })
      },
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(await outcome.handle.exited).toBe(9)
    expect(await collect({ stream: outcome.handle.stdout })).toBe('portable\n')
  } finally {
    await scratch.cleanup()
    await rm(home, { recursive: true, force: true })
  }
})
