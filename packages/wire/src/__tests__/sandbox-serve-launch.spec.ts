import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import { createServeLauncher, HEALTH_PROBE } from '../sandbox-serve-launch.js'
import {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_TOKEN_PATH,
  SERVE_VERSION_PATH,
} from '../serve-env.js'
import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire.js'

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
  alive?: boolean
  tokenMatches?: boolean
  waitSucceeds?: boolean
  logTail?: string
  serveVersion?: string
  stopLeavesCorpse?: boolean
}) => {
  const commands: RecordedCommand[] = []
  const writes: RecordedWrite[] = []
  const ops: string[] = []
  let alive = args.alive === true
  const sandbox = {
    name: 'atlas-thread-x',
    writeFiles: async (files: RecordedWrite[]) => {
      ops.push('write')
      writes.push(...files)
    },
    runCommand: async (params: RecordedCommand) => {
      ops.push('command')
      commands.push(params)
      const script = params.args?.[1] ?? ''
      if (params.detached === true) return { cmdId: 'cmd_1' }
      if (script.startsWith('kill -0')) {
        return { exitCode: alive ? 0 : 1 }
      }
      if (script.includes('kill "$_pid"')) {
        alive = args.stopLeavesCorpse === true
        return { exitCode: 0 }
      }
      if (script.startsWith('printf') && script.includes(SERVE_VERSION_PATH)) {
        const version = args.serveVersion ?? ''
        return { exitCode: 0, stdout: async () => `${version}\n${version === '' ? '' : String(CHANNEL_PROTOCOL_VERSION)}\n` }
      }
      if (script.startsWith('[ ! -s') && script.includes(SERVE_TOKEN_PATH)) {
        return { exitCode: args.tokenMatches === false ? 1 : 0 }
      }
      if (script.startsWith('for i in')) {
        return { exitCode: args.waitSucceeds === false ? 1 : 0 }
      }
      if (script.startsWith('mkdir ')) return { exitCode: 0 }
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

const launchesOf = (commands: RecordedCommand[]): RecordedCommand[] =>
  commands.filter((command) => command.detached === true)

describe('createServeLauncher', () => {
  it('writes the session token before the boot probes once the swap lock is held', async () => {
    const { sandbox, writes, ops } = fakeSandbox({ healthy: true, alive: false })

    await createServeLauncher()({ sandbox, token: 'tok_fresh' })

    expect(writes).toEqual([{ path: SERVE_TOKEN_PATH, content: 'tok_fresh', mode: 0o600 }])
    const writeAt = ops.indexOf('write')
    expect(writeAt).toBeGreaterThan(-1)
    expect(ops.slice(0, writeAt).every((op) => op === 'command')).toBe(true)
  })

  it('leaves the sandbox filesystem alone when no token is given', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: true })

    await createServeLauncher()({ sandbox })

    expect(writes).toHaveLength(0)
  })

  it('never writes the token while a serve process is alive, even when health fails', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: false, alive: true })

    await createServeLauncher()({ sandbox, token: 'tok_fresh' })

    expect(writes).toHaveLength(0)
  })

  it('refuses a token that disagrees with a live serve rather than rotating it under it', async () => {
    const { sandbox, commands, writes } = fakeSandbox({
      healthy: true,
      alive: true,
      tokenMatches: false,
    })

    await expect(
      createServeLauncher()({ sandbox, token: 'tok_stranger' }),
    ).rejects.toThrow('under a different token')

    expect(writes).toHaveLength(0)
    expect(launchesOf(commands)).toHaveLength(0)
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

    expect(launchesOf(commands)).toHaveLength(0)
    expect(scriptsOf(commands).some((script) => script.startsWith('for pid in'))).toBe(false)
  })

  it('never kills processes — a wedged serve is preserved and waited on, not relaunched', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: true })
    const lines: string[] = []

    await createServeLauncher({ log: (line) => lines.push(line) })({ sandbox })

    const scripts = scriptsOf(commands)
    expect(scripts.some((script) => script.includes('kill "$'))).toBe(false)
    expect(scripts.some((script) => script.startsWith('for pid in'))).toBe(false)
    expect(launchesOf(commands)).toHaveLength(0)
    expect(scripts.some((script) => script.startsWith('for i in'))).toBe(true)
    expect(lines.some((line) => line.includes('preserved'))).toBe(true)
  })

  it('fails loudly with the log tail when a live serve never answers, without touching the process', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      alive: true,
      waitSucceeds: false,
      logTail: 'Error: EADDRINUSE: address already in use',
    })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow(
      'EADDRINUSE: address already in use',
    )
    await expect(createServeLauncher()({ sandbox })).rejects.toThrow('preserved rather than killed')
    expect(launchesOf(commands)).toHaveLength(0)
  })

  it('degrades to a marker when the serve log cannot be read', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, alive: true, waitSucceeds: false })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow(
      '<serve log is empty or missing>',
    )
  })

  it('boots a serve only when none is alive, under the flock, with the pid recorded', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    const launches = launchesOf(commands)
    expect(launches).toHaveLength(1)
    const launch = scriptsOf(launches)[0] ?? ''
    expect(launch).toContain(`echo $$ > ${SERVE_HOME}/atlas-serve.pid`)
    expect(launch).toContain(SERVE_LOCK_PATH)
    expect(launch).toContain(SERVE_BINARY_PATH)
    expect(launch).toContain(SERVE_LOG_PATH)
  })

  it('appends serve diagnostics on the mounted home after creating their directory privately', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    const launch = scriptsOf(launchesOf(commands))[0] ?? ''
    expect(SERVE_LOG_PATH).toBe('/atlas/home/operational/atlas-serve.log')
    expect(launch).toContain('umask 077')
    expect(launch).toContain('mkdir -p /atlas/home/operational')
    expect(launch.indexOf('mkdir -p')).toBeLessThan(launch.indexOf(`>> ${SERVE_LOG_PATH}`))
    expect(launch).toContain(`>> ${SERVE_LOG_PATH} 2>&1`)
    expect(SERVE_TOKEN_PATH).toBe('/opt/atlas/atlas-serve.token')
  })

  it('hands the sandbox session id and cloud url to the detached boot, not to process env', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({
      sandbox,
      sandboxSessionId: 'vsn_42',
      cloudUrl: 'https://api.example.com',
    })

    const launch = launchesOf(commands)[0]
    expect(launch?.env).toEqual({
      ATLAS_SANDBOX_SESSION_ID: 'vsn_42',
      ATLAS_CLOUD_URL: 'https://api.example.com',
    })
  })

  it('boots with an empty env when no session identity is handed', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, alive: false })

    await createServeLauncher()({ sandbox })

    expect(launchesOf(commands)[0]?.env).toEqual({})
  })

  it('swaps a drifted serve in place and boots the replacement', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      alive: true,
      serveVersion: '1.88.0',
    })

    await createServeLauncher({ installServe: async () => undefined })({
      sandbox,
      token: 'tok_fresh',
      sandboxSessionId: 'vsn_42',
      desiredVersion: '1.89.1',
    })

    expect(scriptsOf(commands).some((script) => script.includes('kill "$_pid"'))).toBe(true)
    expect(launchesOf(commands)).toHaveLength(1)
  })

  it('includes the serve log tail when a fresh boot never answers', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      alive: false,
      waitSucceeds: false,
      logTail: 'panic: cannot open store',
    })

    await expect(createServeLauncher()({ sandbox })).rejects.toThrow('panic: cannot open store')
  })

  it('logs each launcher decision for operational attribution', async () => {
    const kept = fakeSandbox({ healthy: true })
    const keptLines: string[] = []
    await createServeLauncher({ log: (line) => keptLines.push(line) })({ sandbox: kept.sandbox })
    expect(keptLines.some((line) => line.includes('keeping it'))).toBe(true)

    const booted = fakeSandbox({ healthy: false, alive: false })
    const bootLines: string[] = []
    await createServeLauncher({ log: (line) => bootLines.push(line) })({
      sandbox: booted.sandbox,
    })
    expect(bootLines.some((line) => line.includes('booting it under the flock'))).toBe(true)
    expect(bootLines.some((line) => line.includes('answers /v1/health'))).toBe(true)
  })
})
