import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import {
  createServeLauncher,
  HEALTH_PROBE,
  SERVE_BINARY_PATH,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_NEXT_BINARY_PATH,
  SERVE_STAMP_PATH,
  SERVE_TOKEN_PATH,
  serveStampsReader,
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
      if (script.startsWith('mkdir ')) return { exitCode: 0 }
      if (script.startsWith('cat ')) {
        return { exitCode: 0, stdout: async () => args.installedStamp ?? '' }
      }
      if (script.startsWith('hash=$(sha256sum')) {
        return {
          exitCode: args.verifyExit ?? 0,
          stderr: async () => args.verifyStderr ?? '',
        }
      }
      if (script.startsWith('mv ')) {
        return { exitCode: args.swapExit ?? 0 }
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

const readStamps = async () => ({ install: BUILD_STAMP, acceptable: [BUILD_STAMP] })

const pushedBinary = { bytes: new Uint8Array([1, 2, 3, 4]), sha256: 'f'.repeat(64) }
const readServeBinary = async () => pushedBinary

const scriptsOf = (commands: RecordedCommand[]): string[] =>
  commands.map((command) => command.args?.[1] ?? '')

describe('createServeLauncher', () => {
  it('writes the session token into the sandbox before anything else when one is given', async () => {
    const { sandbox, writes, ops } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamps })({ sandbox, token: 'tok_fresh' })

    expect(writes).toEqual([{ path: SERVE_TOKEN_PATH, content: 'tok_fresh', mode: 0o600 }])
    expect(ops.slice(0, 2)).toEqual(['command', 'write'])
  })

  it('leaves the sandbox filesystem alone when no token is given', async () => {
    const { sandbox, writes } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamps })({ sandbox })

    expect(writes).toHaveLength(0)
  })

  it('authenticates the health probe with the token file, falling back to the launch environment', async () => {
    const { sandbox } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamps })({ sandbox })

    expect(HEALTH_PROBE).toContain(`_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true)`)
    expect(HEALTH_PROBE).toContain('[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"')
    expect(HEALTH_PROBE).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
  })

  it('does nothing when serve is healthy and the installed stamp matches this build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamps })({ sandbox })

    expect(commands).toHaveLength(2)
    expect(scriptsOf(commands).some((script) => script.includes('serve-binary'))).toBe(false)
  })

  it('checks freshness against a stamp file, never by hashing the installed binary', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true, installedStamp: BUILD_STAMP })

    await createServeLauncher({ readStamps })({ sandbox })

    const stampRead = scriptsOf(commands).find((script) => script.startsWith('cat '))
    expect(stampRead).toBe(`cat ${SERVE_STAMP_PATH} 2>/dev/null || true`)
    expect(
      scriptsOf(commands).some((script) => script.startsWith(`sha256sum ${SERVE_BINARY_PATH}`)),
    ).toBe(false)
  })

  it('pushes the injected binary to the .next path, verifies its sha256 inside the sandbox, kills the wedged serve, then swaps it in', async () => {
    const { sandbox, commands, writes, ops } = fakeSandbox({
      healthy: true,
      installedStamp: 'older-build',
    })

    await createServeLauncher({ readStamps, readServeBinary })({ sandbox })

    expect(writes).toEqual([{ path: SERVE_NEXT_BINARY_PATH, content: pushedBinary.bytes }])
    const scripts = scriptsOf(commands)
    const verifyIndex = scripts.findIndex((script) => script.startsWith('hash=$(sha256sum'))
    const killIndex = scripts.findIndex((script) => script.startsWith('for pid in'))
    const swapIndex = scripts.findIndex((script) => script.startsWith('mv '))
    const launchIndex = commands.findIndex((command) => command.detached === true)

    expect(commands[verifyIndex]?.env).toEqual({ ATLAS_EXPECTED_SHA256: pushedBinary.sha256 })
    expect(scripts[verifyIndex]).toContain(SERVE_NEXT_BINARY_PATH)
    expect(scripts[verifyIndex]).not.toContain(`${SERVE_BINARY_PATH} `)
    expect(scripts[swapIndex]).toBe(
      `mv ${SERVE_NEXT_BINARY_PATH} ${SERVE_BINARY_PATH} && chmod 755 ${SERVE_BINARY_PATH} && ` +
        `printf '%s' "$ATLAS_INSTALL_STAMP" > ${SERVE_STAMP_PATH}.next && mv ${SERVE_STAMP_PATH}.next ${SERVE_STAMP_PATH}`,
    )
    expect(commands[swapIndex]?.env).toEqual({ ATLAS_INSTALL_STAMP: BUILD_STAMP })
    expect(ops.indexOf('write')).toBeLessThan(ops.indexOf('command', ops.indexOf('write')))
    expect(verifyIndex).toBeLessThan(killIndex)
    expect(killIndex).toBeLessThan(swapIndex)
    expect(swapIndex).toBeLessThan(launchIndex)
  })

  it('treats a missing stamp file as stale and self-heals through the same local push', async () => {
    const { sandbox, commands, writes } = fakeSandbox({ healthy: false })

    await createServeLauncher({ readStamps, readServeBinary })({ sandbox })

    expect(writes.some((write) => write.path === SERVE_NEXT_BINARY_PATH)).toBe(true)
    const swap = scriptsOf(commands).find((script) => script.startsWith('mv '))
    expect(swap).toContain(SERVE_STAMP_PATH)
  })

  it('fails before touching the running serve when the pushed binary does not match its local hash', async () => {
    const { sandbox, commands } = fakeSandbox({
      healthy: false,
      installedStamp: 'older-build',
      verifyExit: 42,
      verifyStderr: 'the pushed serve binary hashes to deadbeef, not the local file',
    })

    await expect(
      createServeLauncher({ readStamps, readServeBinary })({ sandbox }),
    ).rejects.toThrow('the pushed serve binary hashes to deadbeef, not the local file')

    const scripts = scriptsOf(commands)
    expect(scripts.some((script) => script.startsWith('for pid in'))).toBe(false)
    expect(scripts.some((script) => script.startsWith('mv '))).toBe(false)
    expect(commands.some((command) => command.detached === true)).toBe(false)
  })

  it('throws a clear error when the baked serve is stale and no local binary was supplied', async () => {
    const { sandbox, commands, writes } = fakeSandbox({
      healthy: false,
      installedStamp: 'older-build',
    })

    await expect(createServeLauncher({ readStamps })({ sandbox })).rejects.toThrow(
      'no compatible atlas serve is baked into this sandbox and no fresh binary was supplied to push',
    )

    const scripts = scriptsOf(commands)
    expect(writes).toHaveLength(0)
    expect(scripts.some((script) => script.startsWith('for pid in'))).toBe(false)
    expect(commands.some((command) => command.detached === true)).toBe(false)
  })

  it('trusts the baked serve when no serve source is pinned — an unpinned or source-build image', async () => {
    const { sandbox, commands, writes } = fakeSandbox({
      healthy: true,
      installedStamp: 'whatever-the-image-baked',
    })
    const noPinnedSource = async () => ({ install: '', acceptable: [] })

    await createServeLauncher({ readStamps: noPinnedSource })({ sandbox, token: 'tok' })

    expect(writes).toEqual([{ path: SERVE_TOKEN_PATH, content: 'tok', mode: 0o600 }])
    const scripts = scriptsOf(commands)
    expect(scripts.some((script) => script.startsWith('mv '))).toBe(false)
    expect(commands.some((command) => command.detached === true)).toBe(false)
  })
  it('fails loudly when the verified binary cannot be swapped into place', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, installedStamp: 'older-build', swapExit: 1 })

    await expect(
      createServeLauncher({ readStamps, readServeBinary })({ sandbox }),
    ).rejects.toThrow('swapping the verified atlas serve binary into place failed')
  })

  it('includes the serve log tail when health never answers', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      installedStamp: BUILD_STAMP,
      waitSucceeds: false,
      logTail: 'Error: EADDRINUSE: address already in use',
    })

    await expect(createServeLauncher({ readStamps })({ sandbox })).rejects.toThrow(
      'EADDRINUSE: address already in use',
    )
  })

  it('degrades to a marker when the serve log cannot be read', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, installedStamp: BUILD_STAMP, waitSucceeds: false })

    await expect(createServeLauncher({ readStamps })({ sandbox })).rejects.toThrow(
      '<serve log is empty or missing>',
    )
  })
})

describe('serveStampsReader', () => {
  it('answers this build’s stamps from the caller-supplied sources, with no control-plane read', async () => {
    const stamps = await serveStampsReader({ sources: ['source:this-build'] })()

    expect(stamps).toEqual({ install: 'source:this-build', acceptable: ['source:this-build'] })
  })

  it('accepts every listed source, installing the first', async () => {
    const stamps = await serveStampsReader({ sources: ['source:a', 'source:b'] })()

    expect(stamps).toEqual({ install: 'source:a', acceptable: ['source:a', 'source:b'] })
  })

  it('accepts nothing when the build pins no serve identity', async () => {
    const stamps = await serveStampsReader({ sources: [] })()

    expect(stamps).toEqual({ install: '', acceptable: [] })
  })
})
