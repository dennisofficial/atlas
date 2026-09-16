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

const BUILD_STAMP = 'a'.repeat(64)

const fakeSandbox = (args: {
  healthy: boolean
  stamp?: string
  downloadExit?: number
  downloadStderr?: string
  waitSucceeds?: boolean
}) => {
  const commands: RecordedCommand[] = []
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
      if (script.startsWith('curl -sfS')) {
        return {
          exitCode: args.downloadExit ?? 0,
          stderr: async () => args.downloadStderr ?? '',
        }
      }
      if (script.startsWith('for pid in')) return { exitCode: 0 }
      return { exitCode: args.healthy ? 0 : 1 }
    }),
  }
  return { sandbox: sandbox as unknown as Sandbox, commands }
}

const readStamp = vi.fn(async () => BUILD_STAMP)

const scriptsOf = (commands: RecordedCommand[]): string[] =>
  commands.map((command) => command.args?.[1] ?? '')

describe('createServeLauncher', () => {
  it('does nothing when serve already answers health', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: true })

    await createServeLauncher({ readStamp })(sandbox)

    expect(commands).toHaveLength(1)
    expect(commands[0]?.args?.[1]).toContain(HEALTH_PROBE)
  })

  it('kills any wedged serve, starts detached with its log redirected, then waits for health', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, stamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })(sandbox)

    const scripts = scriptsOf(commands)
    expect(scripts.at(-3)).toContain('for pid in /proc/[0-9]*')
    const start = commands.at(-2)
    expect(start?.detached).toBe(true)
    expect(start?.args?.[1]).toBe(`exec ${SERVE_BINARY_PATH} >> ${SERVE_LOG_PATH} 2>&1`)
    const wait = commands.at(-1)
    expect(wait?.args?.[1]).toContain(HEALTH_PROBE)
    expect(wait?.timeoutMs).toBeGreaterThan(90 * 2 * 1000)
  })

  it('does not download when the sandbox already carries this exact build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, stamp: BUILD_STAMP })

    await createServeLauncher({ readStamp })(sandbox)

    expect(scriptsOf(commands).some((script) => script.startsWith('curl -sfS'))).toBe(false)
  })

  it('downloads the binary from the API and re-stamps when the sandbox carries a different build', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false, stamp: 'older-build' })

    await createServeLauncher({ readStamp })(sandbox)

    const download = scriptsOf(commands).find((script) => script.startsWith('curl -sfS'))
    expect(download).toContain('Authorization: Bearer $ATLAS_SERVE_TOKEN')
    expect(download).toContain(
      `"$ATLAS_CLOUD_URL/v1/sandboxes/$ATLAS_THREAD_ID/serve-binary"`,
    )
    expect(download).toContain(`-o ${SERVE_BINARY_PATH}`)
    expect(download).toContain(`chmod 755 ${SERVE_BINARY_PATH}`)
    expect(download).toContain(`> ${SERVE_STAMP_PATH}`)
    expect(download).toContain(BUILD_STAMP)
    expect(commands.at(-2)?.detached).toBe(true)
  })

  it('downloads when the sandbox has never seen a binary', async () => {
    const { sandbox, commands } = fakeSandbox({ healthy: false })

    await createServeLauncher({ readStamp })(sandbox)

    expect(scriptsOf(commands).some((script) => script.startsWith('curl -sfS'))).toBe(true)
  })

  it('fails loudly with curl stderr when the download fails', async () => {
    const { sandbox } = fakeSandbox({
      healthy: false,
      downloadExit: 22,
      downloadStderr: 'curl: (22) The requested URL returned error: 401',
    })

    await expect(createServeLauncher({ readStamp })(sandbox)).rejects.toThrow('401')
  })

  it('fails loudly, naming the in-sandbox log, when health never answers', async () => {
    const { sandbox } = fakeSandbox({ healthy: false, stamp: BUILD_STAMP, waitSucceeds: false })

    await expect(createServeLauncher({ readStamp })(sandbox)).rejects.toThrow(SERVE_LOG_PATH)
  })
})
