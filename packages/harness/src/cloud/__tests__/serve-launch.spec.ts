import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import {
  createServeLauncher,
  HEALTH_PROBE,
  SERVE_BINARY_PATH,
  SERVE_BINARY_SHA256_HEADER,
  SERVE_HEADERS_PATH,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_NEXT_BINARY_PATH,
  SERVE_STAMP_PATH,
  SERVE_TOKEN_PATH,
  serveStampReader,
  StaleSandboxTokenError,
} from '../serve-launch'

interface RecordedCommand {
  cmd: string
  args?: string[]
  detached?: boolean
  timeoutMs?: number
  env?: Record<string, string>
}

const BUILD_STAMP = 'a'.repeat(64)

interface RecordedWrite {
  path: string
  content: string | Uint8Array
  mode?: number
}

const fakeSandbox = (args: {
  healthy: boolean
  installedStamp?: string
  downloadExit?: number
  downloadStderr?: string
  verifyExit?: number
  verifyStderr?: string
  swapExit?: number
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
      if (script.startsWith('cat ')) {
        return { exitCode: 0, stdout: async () => args.installedStamp ?? '' }
      }
      if (script.startsWith('expected=$(grep')) {
        return {
          exitCode: args.verifyExit ?? 0,
          stderr: async () => args.verifyStderr ?? '',
        }
      }
      if (script.startsWith('mv ')) {
        return { exitCode: args.swapExit ?? 0 }
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
    },
  }
  return { sandbox: sandbox as unknown as Sandbox, commands, writes, ops }
}

const readStamp = async () => BUILD_STAMP

const scriptsOf = (commands: RecordedCommand[]): string[] =>
  commands.map((command) => command.args?.[1] ?? '')

describe('createServeLauncher', () => {
  it('writes the session token into the sandbox before anything else when one is given', async () => {
    const { sandbox, writes, ops } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox, token: 'tok_fresh' })

    expect(writes).toEqual([{ path: SERVE_TOKEN_PATH, content: 'tok_fresh', mode: 0o600 }])
    expect(ops.slice(0, 2)).toEqual(['command', 'write'])
  })

  it('leaves the sandbox filesystem alone when no token is given', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(writes).toHaveLength(0)
  })

  it('authenticates the health probe with the token file, falling back to the launch environment', async () => {
    const { sandbox } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(HEALTH_PROBE).toContain(`_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true)`)
    expect(HEALTH_PROBE).toContain('[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"')
    expect(HEALTH_PROBE).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
  })

  it('does nothing when serve is healthy and the installed stamp matches this build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(commands).toHaveLength(2)
    expect(scriptsOf(commands).some((script) => script.includes('curl -sS'))).toBe(false)
  })

  it('checks freshness against a stamp file, never by hashing the installed binary', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    const stampRead = scriptsOf(commands).find((script) => script.startsWith('cat '))
    expect(stampRead).toBe(`cat ${SERVE_STAMP_PATH} 2>/dev/null || true`)
    expect(
      scriptsOf(commands).some((script) => script.startsWith(`sha256sum ${SERVE_BINARY_PATH}`)),
    ).toBe(false)
  })

  it('reinstalls when serve answers but the installed stamp is from another build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, installedStamp: 'older-build' })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(scriptsOf(commands).some((script) => script.includes('curl -sS'))).toBe(true)
    expect(commands.at(-2)?.detached).toBe(true)
  })

  it('treats a missing stamp file as stale exactly once and self-heals through the same download path', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(scriptsOf(commands).some((script) => script.includes('curl -sS'))).toBe(true)
    const swap = scriptsOf(commands).find((script) => script.startsWith('mv '))
    expect(swap).toContain(SERVE_STAMP_PATH)
  })

  it('bounds the health probe so a hung listener cannot stall the launch', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(HEALTH_PROBE).toContain('-m 5')
    expect(HEALTH_PROBE).toContain('--connect-timeout 2')
    expect(commands[0]?.timeoutMs).toBeLessThanOrEqual(15_000)
  })

  it('kills a wedged serve by exact executable match, escalating to SIGKILL, then starts under a lock', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, installedStamp: BUILD_STAMP })

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

  it('does not download when the installed stamp already matches this build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })({ sandbox })

    expect(scriptsOf(commands).some((script) => script.includes('curl -sS'))).toBe(false)
  })

  it('downloads to the .next path beside the live binary, capturing the response headers', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, installedStamp: 'older-build' })

    await createServeLauncher({ readStamp })({ sandbox })

    const download = scriptsOf(commands).find((script) => script.includes('curl -sS'))
    expect(download).toContain(`_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true)`)
    expect(download).toContain('mkdir -p /opt/atlas && ')
    expect(download).toContain('--retry 3 --retry-all-errors')
    expect(download).toContain(`-D ${SERVE_HEADERS_PATH}`)
    expect(download).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
    expect(download).toContain(`"$ATLAS_CLOUD_URL/v1/sandboxes/$ATLAS_THREAD_ID/serve-binary"`)
    expect(download).toContain(`-o ${SERVE_NEXT_BINARY_PATH}`)
    expect(download).not.toContain(`-o ${SERVE_BINARY_PATH} `)
    expect(download).not.toContain('chmod')
  })

  it('verifies the download against the response header hash, kills the wedged serve, then swaps the binary and writes the stamp before launching', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, installedStamp: 'older-build' })

    await createServeLauncher({ readStamp })({ sandbox })

    const scripts = scriptsOf(commands)
    const downloadIndex = scripts.findIndex((script) => script.includes('curl -sS'))
    const verifyIndex = scripts.findIndex((script) => script.startsWith('expected=$(grep'))
    const killIndex = scripts.findIndex((script) => script.startsWith('for pid in'))
    const swapIndex = scripts.findIndex((script) => script.startsWith('mv '))
    const launchIndex = commands.findIndex((command) => command.detached === true)

    expect(scripts[verifyIndex]).toContain(SERVE_HEADERS_PATH)
    expect(scripts[verifyIndex]).toContain(SERVE_BINARY_SHA256_HEADER)
    expect(scripts[verifyIndex]).toContain(SERVE_NEXT_BINARY_PATH)
    expect(scripts[swapIndex]).toBe(
      `mv ${SERVE_NEXT_BINARY_PATH} ${SERVE_BINARY_PATH} && chmod 755 ${SERVE_BINARY_PATH} && ` +
        `printf '%s' "$ATLAS_INSTALL_STAMP" > ${SERVE_STAMP_PATH}.next && mv ${SERVE_STAMP_PATH}.next ${SERVE_STAMP_PATH}`,
    )
    expect(commands[swapIndex]?.env).toEqual({ ATLAS_INSTALL_STAMP: BUILD_STAMP })
    expect(downloadIndex).toBeLessThan(verifyIndex)
    expect(verifyIndex).toBeLessThan(killIndex)
    expect(killIndex).toBeLessThan(swapIndex)
    expect(swapIndex).toBeLessThan(launchIndex)
  })

  it('fails before touching the running serve when the downloaded binary does not match the response header hash', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      installedStamp: 'older-build',
      verifyExit: 42,
      verifyStderr: 'downloaded serve binary hash deadbeef does not match the response header',
    })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toThrow(
      'downloaded serve binary hash deadbeef does not match the response header',
    )

    const scripts = scriptsOf(commands)
    expect(scripts.some((script) => script.startsWith('for pid in'))).toBe(false)
    expect(scripts.some((script) => script.startsWith('mv '))).toBe(false)
    expect(commands.some((command) => command.detached === true)).toBe(false)
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

  it('fails loudly when the verified binary cannot be swapped into place', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, installedStamp: 'older-build', swapExit: 1 })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toThrow(
      'swapping the verified atlas serve binary into place failed',
    )
  })

  it('includes the serve log tail when health never answers', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      installedStamp: BUILD_STAMP,
      waitSucceeds: false,
      logTail: 'Error: EADDRINUSE: address already in use',
    })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toThrow(
      'EADDRINUSE: address already in use',
    )
  })

  it('degrades to a marker when the serve log cannot be read', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, installedStamp: BUILD_STAMP, waitSucceeds: false })

    await expect(createServeLauncher({ readStamp })({ sandbox })).rejects.toThrow(
      '<serve log is empty or missing>',
    )
  })
})

describe('serveStampReader', () => {
  it('HEADs the serve-binary route with the sandbox token and reads the hash header', async () => {
    const seen: { url: string; method: string; authorization?: string }[] = []
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      seen.push({
        url: String(input),
        method: init?.method ?? 'GET',
        ...(headers?.authorization === undefined ? {} : { authorization: headers.authorization }),
      })
      return new Response(null, {
        status: 200,
        headers: { [SERVE_BINARY_SHA256_HEADER]: BUILD_STAMP },
      })
    }) as typeof fetch

    const stamp = await serveStampReader({
      cloudUrl: 'https://cloud.test/',
      threadId: 'brn_cloud',
      token: 'sandbox-token',
      fetchFn,
    })()

    expect(seen).toEqual([
      {
        url: 'https://cloud.test/v1/sandboxes/brn_cloud/serve-binary',
        method: 'HEAD',
        authorization: 'Bearer sandbox-token',
      },
    ])
    expect(stamp).toBe(BUILD_STAMP)
  })

  it('fails the launch rather than guessing when the answer carries no hash header', async () => {
    const fetchFn = (async (_input: unknown) => new Response(null, { status: 200 })) as typeof fetch

    await expect(
      serveStampReader({
        cloudUrl: 'https://cloud.test',
        threadId: 'brn_cloud',
        token: 'sandbox-token',
        fetchFn,
      })(),
    ).rejects.toThrow(SERVE_BINARY_SHA256_HEADER)
  })

  it('fails the launch when the control plane refuses the read', async () => {
    const fetchFn = (async (_input: unknown) =>
      new Response(null, { status: 401 })) as typeof fetch

    await expect(
      serveStampReader({
        cloudUrl: 'https://cloud.test',
        threadId: 'brn_cloud',
        token: 'sandbox-token',
        fetchFn,
      })(),
    ).rejects.toThrow('401')
  })
})
