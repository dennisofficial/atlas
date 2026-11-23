import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'bun:test'

import {
  toThreadId,
  type ProcessPort,
  type SpawnCommand,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { BashTool } from '../bash'
import type { ShellLauncher } from '../shell-launcher'
import { files, processes, TestShellLauncher, useTempAtlasHome } from './support'

useTempAtlasHome()

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-bash-background-start-'))
})

const run = (args: {
  launcher: ShellLauncher
  input: Record<string, unknown>
  processes?: ProcessPort
  shellEnv?: () => Promise<Record<string, string>>
  signal?: AbortSignal
}): Promise<ToolOutcome> =>
  new BashTool({
    launcher: args.launcher,
    files,
    processes: args.processes ?? processes,
    ...(args.shellEnv === undefined ? {} : { shellEnv: args.shellEnv }),
  }).invoke({
    input: { description: 'Start the build', ...args.input },
    signal: args.signal ?? new AbortController().signal,
    idempotencyKey: 'bash-background-start',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })

const outputOf = (outcome: ToolOutcome): Record<string, unknown> => {
  if (!outcome.ok) throw new Error(`expected a successful outcome, got: ${outcome.reason}`)
  return outcome.output as Record<string, unknown>
}

const recordingProcesses = (spawned: SpawnCommand[]): ProcessPort => ({
  spawn: (args) => {
    spawned.push(args)
    return processes.spawn(args)
  },
  which: (args) => processes.which(args),
})

describe('bash started with background true', () => {
  it('launches the command and returns its shell id at once, without spawning an exec', async () => {
    const launcher = new TestShellLauncher()
    const spawned: SpawnCommand[] = []

    const outcome = await run({
      launcher,
      processes: recordingProcesses(spawned),
      input: { command: 'bun run build', background: true, timeoutMs: 900_000 },
    })

    const output = outputOf(outcome)
    expect(output).toMatchObject({
      command: 'bun run build',
      description: 'Start the build',
      backgrounded: true,
      pid: 4_242,
      timeoutMs: 900_000,
    })
    expect(String(output.shellId)).toMatch(/^shell-[0-9a-f]{8}$/)
    expect(launcher.launched).toHaveLength(1)
    expect(launcher.launched[0]).toMatchObject({
      shellId: output.shellId,
      command: 'bun run build',
      cwd: root,
      env: {},
      timeoutMs: 900_000,
    })
    expect(launcher.launched[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(spawned).toEqual([])
  }, 30_000)

  it('passes the session env and the workdir to the launch', async () => {
    const launcher = new TestShellLauncher()
    const nested = join(root, 'nested')
    await mkdir(nested, { recursive: true })

    await run({
      launcher,
      input: { command: 'bun run build', background: true, workdir: nested },
      shellEnv: async () => ({ GH_TOKEN: 'gho_abc' }),
    })

    expect(launcher.launched[0]?.cwd).toBe(nested)
    expect(launcher.launched[0]?.env).toEqual({ GH_TOKEN: 'gho_abc' })
  }, 30_000)

  it('takes a timeoutMs past the foreground maximum as a kill ceiling, not a wait window', async () => {
    const launcher = new TestShellLauncher()

    const outcome = await run({
      launcher,
      input: { command: 'bun run build', background: true, timeoutMs: 900_000 },
    })

    expect(launcher.launched[0]?.timeoutMs).toBe(900_000)
    expect(outcome.ok && outcome.modelText).toContain(
      'The shell is killed if it outlives 900000 ms',
    )
  }, 30_000)

  it('leaves timeoutMs out of the launch and the output when the call names none', async () => {
    const launcher = new TestShellLauncher()

    const output = outputOf(
      await run({ launcher, input: { command: 'bun run build', background: true } }),
    )

    expect(launcher.launched[0]).not.toHaveProperty('timeoutMs')
    expect(output).not.toHaveProperty('timeoutMs')
  }, 30_000)

  it('starts a sleep that the foreground path refuses', async () => {
    const launcher = new TestShellLauncher()

    const outcome = await run({ launcher, input: { command: 'sleep 600', background: true } })

    expect(outcome.ok).toBe(true)
    expect(launcher.launched).toHaveLength(1)
  }, 30_000)

  it('returns the launcher failure and its reason', async () => {
    const launcher = new TestShellLauncher({
      ok: false,
      reason: 'a shell with id shell-1a2b3c4d already exists',
    })

    const outcome = await run({ launcher, input: { command: 'bun run build', background: true } })

    expect(outcome).toEqual({ ok: false, reason: 'a shell with id shell-1a2b3c4d already exists' })
  }, 30_000)

  it('tells the model where the shell goes and how to read and stop it', async () => {
    const launcher = new TestShellLauncher()

    const outcome = await run({ launcher, input: { command: 'bun run build', background: true } })

    if (!outcome.ok) throw new Error(outcome.reason)
    const shellId = String(outputOf(outcome).shellId)
    expect(outcome.modelText).toContain(`Started in the background as shell ${shellId}`)
    expect(outcome.modelText).toContain('do not wait on it')
    expect(outcome.modelText).toContain(`shell_output({ shellId: "${shellId}" })`)
    expect(outcome.modelText).toContain('shell_kill')
  }, 30_000)

  it('keeps stdin closed unless the call asks for input', async () => {
    const launcher = new TestShellLauncher()

    const output = outputOf(
      await run({ launcher, input: { command: 'bun run build', background: true } }),
    )

    expect(launcher.launched[0]?.input).toBe(false)
    expect(output).not.toHaveProperty('input')
  }, 30_000)

  it('opens stdin for a background shell started with input true and says shell_input answers it', async () => {
    const launcher = new TestShellLauncher()

    const outcome = await run({
      launcher,
      input: { command: 'gh auth login', background: true, input: true },
    })

    expect(launcher.launched[0]?.input).toBe(true)
    expect(outputOf(outcome)).toMatchObject({ backgrounded: true, input: true })
    expect(outcome.ok && outcome.modelText).toContain('shell_input')
  }, 30_000)

  it('moves a call with input but no background to the background at once and says so', async () => {
    const launcher = new TestShellLauncher()
    const spawned: SpawnCommand[] = []

    const outcome = await run({
      launcher,
      processes: recordingProcesses(spawned),
      input: { command: 'gh auth login', input: true },
    })

    expect(outputOf(outcome)).toMatchObject({ backgrounded: true, input: true })
    expect(launcher.launched[0]?.input).toBe(true)
    expect(spawned).toEqual([])
    expect(outcome.ok && outcome.modelText).toContain(
      'input needs a background shell, so this command started in the background',
    )
  }, 30_000)

  it('says nothing about moving a call that asked for background itself', async () => {
    const outcome = await run({
      launcher: new TestShellLauncher(),
      input: { command: 'gh auth login', background: true, input: true },
    })

    expect(outcome.ok && outcome.modelText).not.toContain('input needs a background shell')
  }, 30_000)

  it('rejects the fields the schema no longer takes', async () => {
    for (const input of [{ runInBackground: true }, { watch: 'ERROR' }]) {
      const outcome = await run({
        launcher: new TestShellLauncher(),
        input: { command: 'echo hi', ...input },
      })

      expect(outcome).toMatchObject({ ok: false })
      expect(!outcome.ok && outcome.reason).toContain('bash was called with invalid input')
    }
  }, 30_000)

  it('does not launch when the turn was already interrupted', async () => {
    const launcher = new TestShellLauncher()
    const controller = new AbortController()
    controller.abort()

    const outcome = await run({
      launcher,
      input: { command: 'bun run build', background: true },
      signal: controller.signal,
    })

    expect(outcome.ok).toBe(false)
    expect(launcher.launched).toEqual([])
  }, 30_000)
})
