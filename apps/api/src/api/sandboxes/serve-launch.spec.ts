import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Sandbox } from '@vercel/sandbox'
import {
  createServeLauncher,
  HEALTH_PROBE,
  SERVE_BINARY_PATH,
  SERVE_LOG_PATH,
  SERVE_STAMP_PATH,
} from './serve-launch'

interface RecordedCommand {
  cmd: string
  args?: string[]
  detached?: boolean
  timeoutMs?: number
}

const binary = new Uint8Array([0x7f, 0x45, 0x4c, 0x46])
const binaryStamp = createHash('sha256').update(binary).digest('hex')

const fakeSandbox = (args: { healthy: boolean; stamp?: string; waitSucceeds?: boolean }) => {
  const commands: RecordedCommand[] = []
  const writes: { path: string; content: Uint8Array | string; mode?: number }[][] = []
  const sandbox = {
    runCommand: vi.fn(async (params: RecordedCommand) => {
      commands.push(params)
      const script = params.args?.[1] ?? ''
      if (params.detached === true) return { cmdId: 'cmd_1' }
      if (script.startsWith('for i in')) {
        return { exitCode: args.waitSucceeds === false ? 1 : 0 }
      }
      if (script.startsWith('cat ')) {
        return { exitCode: 0, stdout: async () => args.stamp ?? '' }
      }
      if (script.startsWith('for pid in')) return { exitCode: 0 }
      return { exitCode: args.healthy ? 0 : 1 }
    }),
    writeFiles: vi.fn(
      async (files: { path: string; content: Uint8Array | string; mode?: number }[]) => {
        writes.push(files)
      },
    ),
  }
  return { sandbox: sandbox as unknown as Sandbox, commands, writes }
}

const readBinary = vi.fn(async () => binary)

const scriptsOf = (commands: RecordedCommand[]): string[] =>
  commands.map((command) => command.args?.[1] ?? '')

describe('createServeLauncher', () => {
  it('does nothing when serve already answers health', async () => {
    const { sandbox, commands, writes } = fakeSandbox({ healthy: true })

    await createServeLauncher({ readBinary })(sandbox)

    expect(commands).toHaveLength(1)
    expect(commands[0]?.args?.[1]).toContain(HEALTH_PROBE)
    expect(writes).toHaveLength(0)
  })

  it('kills any wedged serve, starts detached with its log redirected, then waits for health', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, stamp: binaryStamp })

    await createServeLauncher({ readBinary })(sandbox)

    const scripts = scriptsOf(commands)
    expect(scripts.at(-3)).toContain('for pid in /proc/[0-9]*')
    const start = commands.at(-2)
    expect(start?.detached).toBe(true)
    expect(start?.args?.[1]).toBe(`exec ${SERVE_BINARY_PATH} >> ${SERVE_LOG_PATH} 2>&1`)
    const wait = commands.at(-1)
    expect(wait?.args?.[1]).toContain(HEALTH_PROBE)
    expect(wait?.timeoutMs).toBeGreaterThan(90 * 2 * 1000)
  })

  it('does not reinstall when the sandbox already carries this exact binary', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: false, stamp: binaryStamp })

    await createServeLauncher({ readBinary })(sandbox)

    expect(writes).toHaveLength(0)
  })

  it('reinstalls binary and stamp when the sandbox carries a different build', async () => {
    const { sandbox, commands, writes } = fakeSandbox({ healthy: false, stamp: 'older-build' })

    await createServeLauncher({ readBinary })(sandbox)

    expect(writes).toEqual([
      [
        { path: SERVE_BINARY_PATH, content: binary, mode: 0o755 },
        { path: SERVE_STAMP_PATH, content: binaryStamp },
      ],
    ])
    expect(commands.at(-2)?.detached).toBe(true)
  })

  it('installs when the sandbox has never seen a binary', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: false })

    await createServeLauncher({ readBinary })(sandbox)

    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]).toEqual({ path: SERVE_BINARY_PATH, content: binary, mode: 0o755 })
  })

  it('fails loudly, naming the in-sandbox log, when health never answers', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, stamp: binaryStamp, waitSucceeds: false })

    await expect(createServeLauncher({ readBinary })(sandbox)).rejects.toThrow(SERVE_LOG_PATH)
  })
})
