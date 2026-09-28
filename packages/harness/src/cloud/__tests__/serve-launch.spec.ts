import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import {
  createServeLauncher,
  HEALTH_PROBE,
  SERVE_BINARY_PATH,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_TOKEN_PATH,
} from '../serve-launch'

interface RecordedCommand {
  cmd: string
  args?: string[]
  detached?: boolean
  timeoutMs?: number
  env?: Record<string, string>
}

interface RecordedWrite {
  path: string
  content: string | Uint8Array
  mode?: number
}

const fakeSandbox = (args: {
  healthy: boolean
  waitSucceeds?: boolean
  logTail?: string
}) => {
  const commands: RecordedCommand[] = []
  const writes: RecordedWrite[] = []
  const ops: string[] = []
  const sandbox = {
    writeFiles: async (files: RecordedWrite[]) => {
      ops.push('write')
      writes.push(...files)
    },
    runCommand: async (params: RecordedCommand) => {
      ops.push('command')
      commands.push(params)
      const script = params.args?.[1] ?? ''
      if (params.detached === true) return { cmdId: 'cmd_1' }
      if (script.startsWith('for i in')) {
        return { exitCode: args.waitSucceeds === false ? 1 : 0 }
      }
      if (script.startsWith('mkdir ')) return { exitCode: 0 }
      if (script.startsWith('for pid in')) return { exitCode: 0 }
      if (script.startsWith('tail -c')) {
        return { exitCode: 0, stdout: async () => args.logTail ?? '' }
      }
      return { exitCode: args.healthy ? 0 : 1 }
    },
  }
  return { sandbox: sandbox as unknown as Sandbox, commands, writes, ops }
}

const scriptsOf = (commands: RecordedCommand[]): string[] =>
  commands.map((command) => command.args?.[1] ?? '')

describe('createServeLauncher', () => {
  it('writes the session token into the sandbox before anything else when one is given', async () => {
    const { sandbox, writes, ops } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox, token: 'tok_fresh' })

    expect(writes).toEqual([{ path: SERVE_TOKEN_PATH, content: 'tok_fresh', mode: 0o600 }])
    expect(ops.slice(0, 2)).toEqual(['command', 'write'])
  })

  it('leaves the sandbox filesystem alone when no token is given', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox })

    expect(writes).toHaveLength(0)
  })

  it('authenticates the health probe with the token file, falling back to the launch environment', async () => {
    const { sandbox } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox })

    expect(HEALTH_PROBE).toContain(`_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true)`)
    expect(HEALTH_PROBE).toContain('[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"')
    expect(HEALTH_PROBE).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
  })

  it('does nothing when serve is already healthy', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox })

    const scripts = scriptsOf(commands)
    expect(scripts.some((script) => script.startsWith('for pid in'))).toBe(false)
    expect(commands.some((command) => command.detached === true)).toBe(false)
  })

  it('never re-hashes or swaps the installed binary — freshness is the driver’s image pin, not the launcher’s', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false })

    await createServeLauncher()({ sandbox })

    const scripts = scriptsOf(commands)
    expect(scripts.some((script) => script.startsWith('sha256sum'))).toBe(false)
    expect(scripts.some((script) => script.startsWith('mv '))).toBe(false)
    expect(scripts.some((script) => script.startsWith('cat '))).toBe(false)
  })

  it('kills a wedged serve and relaunches it under the lock when health fails', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false })

    await createServeLauncher()({ sandbox })

    const scripts = scriptsOf(commands)
    const killIndex = scripts.findIndex((script) => script.startsWith('for pid in'))
    const launchIndex = commands.findIndex((command) => command.detached === true)
    expect(killIndex).toBeGreaterThanOrEqual(0)
    expect(launchIndex).toBeGreaterThan(killIndex)
    const launch = scriptsOf([commands[launchIndex]!])[0] ?? ''
    expect(launch).toContain(SERVE_LOCK_PATH)
    expect(launch).toContain(SERVE_BINARY_PATH)
    expect(launch).toContain(SERVE_LOG_PATH)
  })

  it('includes the serve log tail when health never answers', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      waitSucceeds: false,
      logTail: 'Error: EADDRINUSE: address already in use',
    })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow(
      'EADDRINUSE: address already in use',
    )
  })

  it('degrades to a marker when the serve log cannot be read', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, waitSucceeds: false })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow(
      '<serve log is empty or missing>',
    )
  })
})
