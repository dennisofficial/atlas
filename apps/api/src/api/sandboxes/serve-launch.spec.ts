import { describe, expect, it, vi } from 'vitest'
import type { Sandbox } from '@vercel/sandbox'
import {
  createServeLauncher,
  HEALTH_PROBE,
  SERVE_BINARY_PATH,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_TOKEN_PATH,
  StaleSandboxTokenError,
} from './serve-launch'

interface RecordedCommand {
  cmd: string
  args?: string[]
  detached?: boolean
  timeoutMs?: number
}

const BUILD_STAMP = 'a'.repeat(64)

interface RecordedWrite {
  path: string
  content: string | Uint8Array
  mode?: number
}

const fakeSandbox = (args: {
  healthy: boolean
  hash?: string
  downloadExit?: number
  downloadStderr?: string
  waitSucceeds?: boolean
  logTail?: string
}) => {
  const commands: RecordedCommand[] = []
  const writes: RecordedWrite[] = []
  const ops: string[] = []
  const sandbox = {
    writeFiles: vi.fn(async (files: RecordedWrite[]) => {
      ops.push('write')
      writes.push(...files)
    }),
    runCommand: vi.fn(async (params: RecordedCommand) => {
      ops.push('command')
      commands.push(params)
      const script = params.args?.[1] ?? ''
      if (params.detached === true) return { cmdId: 'cmd_1' }
      if (script.startsWith('for i in')) {
        return { exitCode: args.waitSucceeds === false ? 1 : 0 }
      }
      if (script.startsWith('sha256sum ')) {
        return { exitCode: 0, stdout: async () => args.hash ?? '' }
      }
      if (script.includes('curl -sS')) {
        return {
          exitCode: args.downloadExit ?? 0,
          stderr: async () => args.downloadStderr ?? '',
        }
      }
      if (script.startsWith('for pid in')) return { exitCode: 0 }
      if (script.startsWith('tail -c')) {
        return { exitCode: 0, stdout: async () => args.logTail ?? '' }
      }
      return { exitCode: args.healthy ? 0 : 1 }
    }),
  }
  return { sandbox: sandbox as unknown as Sandbox, commands, writes, ops }
}

const readStamp = vi.fn(async () => BUILD_STAMP)

const scriptsOf = (commands: RecordedCommand[]): string[] =>
  commands.map((command) => command.args?.[1] ?? '')

describe('createServeLauncher', () => {
  it('writes the session token into the sandbox before anything else when one is given', async () => {
    const { sandbox, writes, ops } = fakeSandbox({ healthy: true, hash: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox, token: 'tok_fresh' })

    expect(writes).toEqual([{ path: SERVE_TOKEN_PATH, content: 'tok_fresh', mode: 0o600 }])
    expect(ops[0]).toBe('write')
  })

  it('leaves the sandbox filesystem alone when no token is given', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: true, hash: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(writes).toHaveLength(0)
  })

  it('authenticates the health probe with the token file, falling back to the launch environment', async () => {
    const { sandbox } = fakeSandbox({ healthy: true, hash: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(HEALTH_PROBE).toContain(`_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true)`)
    expect(HEALTH_PROBE).toContain('[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"')
    expect(HEALTH_PROBE).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
  })

  it('does nothing when serve is healthy and the installed binary matches this build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, hash: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(commands).toHaveLength(2)
    expect(scriptsOf(commands).some((script) => script.includes('curl -sS'))).toBe(false)
  })

  it('reinstalls when serve answers but the running binary is from another build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, hash: 'older-build' })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(scriptsOf(commands).some((script) => script.includes('curl -sS'))).toBe(true)
    expect(commands.at(-2)?.detached).toBe(true)
  })

  it('bounds the health probe so a hung listener cannot stall the launch', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, hash: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(HEALTH_PROBE).toContain('-m 5')
    expect(HEALTH_PROBE).toContain('--connect-timeout 2')
    expect(commands[0]?.timeoutMs).toBeLessThanOrEqual(15_000)
  })

  it('kills a wedged serve by exact executable match, escalating to SIGKILL, then starts under a lock', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, hash: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    const scripts = scriptsOf(commands)
    const kill = scripts.find((script) => script.startsWith('for pid in'))
    expect(kill).toContain(`'^${SERVE_BINARY_PATH}'`)
    expect(kill).toContain('kill -9')
    const start = commands.at(-2)
    expect(start?.detached).toBe(true)
    expect(start?.args?.[1]).toBe(
      `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
        `[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"; true; ` +
        `exec flock -n ${SERVE_LOCK_PATH} ${SERVE_BINARY_PATH} >> ${SERVE_LOG_PATH} 2>&1`,
    )
    const wait = commands.at(-1)
    expect(wait?.args?.[1]).toContain(HEALTH_PROBE)
    expect(wait?.timeoutMs).toBeGreaterThan(90 * 2 * 1000)
  })

  it('does not download when the installed binary already hashes to this build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, hash: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(scriptsOf(commands).some((script) => script.includes('curl -sS'))).toBe(false)
  })

  it('downloads with retries and a status check when the binary is missing or stale', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, hash: 'older-build' })

    await createServeLauncher({ readStamp })({ sandbox })

    const download = scriptsOf(commands).find((script) => script.includes('curl -sS'))
    expect(download).toContain(`_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true)`)
    expect(download).toContain('mkdir -p /vercel/sandbox && ')
    expect(download).toContain('--retry 3 --retry-all-errors')
    expect(download).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
    expect(download).toContain(`"$ATLAS_CLOUD_URL/v1/sandboxes/$ATLAS_THREAD_ID/serve-binary"`)
    expect(download).toContain(`-o ${SERVE_BINARY_PATH}`)
    expect(download).toContain(`chmod 755 ${SERVE_BINARY_PATH}`)
    expect(commands.at(-2)?.detached).toBe(true)
  })

  it('throws StaleSandboxTokenError when the download is rejected as unauthorized', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, downloadExit: 41 })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toBeInstanceOf(
      StaleSandboxTokenError,
    )
  })

  it('fails loudly with curl stderr when the download fails for another reason', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      downloadExit: 22,
      downloadStderr: 'download answered HTTP 500',
    })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toThrow('HTTP 500')
  })

  it('includes the serve log tail when health never answers', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      hash: BUILD_STAMP,
      waitSucceeds: false,
      logTail: 'Error: EADDRINUSE: address already in use',
    })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toThrow(
      'EADDRINUSE: address already in use',
    )
  })

  it('degrades to a marker when the serve log cannot be read', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, hash: BUILD_STAMP, waitSucceeds: false })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toThrow(
      '<serve log is empty or missing>',
    )
  })
})
