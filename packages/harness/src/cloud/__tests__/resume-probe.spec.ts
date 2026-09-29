import { describe, expect, it } from 'bun:test'

import { APIError, Sandbox } from '@vercel/sandbox'

import { SERVE_VERSION_PATH } from '../serve-launch'
import { ESandboxProbe, probeSandboxForResume } from '../resume-probe'
import { asVercelFailure, isSandboxMissing } from '../vercel-errors'

const PINNED = '2.0.0'

const fakeSandbox = (args: { installed: string }): Sandbox & { deleted: () => boolean } => {
  let deleted = false
  const base = {
    name: 'atlas-thread-x',
    runCommand: async () => ({
      exitCode: 0,
      stdout: async () => `${args.installed}\n`,
      stderr: async () => '',
    }),
    domain: () => 'https://sb-3000.vercel.run',
    delete: async () => {
      deleted = true
    },
  }
  const sandbox = base as unknown as Sandbox
  return Object.assign(sandbox, { deleted: () => deleted }) as Sandbox & {
    deleted: () => boolean
  }
}

const probeOf = (args: {
  sandbox: Sandbox
  waitForDriveDetached?: () => Promise<boolean>
  lines?: string[]
}) =>
  probeSandboxForResume({
    name: 'atlas-thread-x',
    pinned: PINNED,
    timeoutMs: 5_000,
    servePort: 3000,
    fetch: async () => args.sandbox,
    clientsAttached: async () => false,
    ...(args.waitForDriveDetached === undefined
      ? {}
      : { waitForDriveDetached: args.waitForDriveDetached }),
    log: args.lines === undefined ? undefined : (line) => args.lines?.push(line),
    isMissing: isSandboxMissing,
    toFailure: asVercelFailure,
  })

describe('probeSandboxForResume', () => {
  it('answers missing when Vercel has never heard of the sandbox', async () => {
    const result = await probeSandboxForResume({
      name: 'atlas-thread-x',
      pinned: PINNED,
      timeoutMs: 5_000,
      servePort: 3000,
      fetch: async () => {
        throw new APIError(new Response(null, { status: 404 }), { message: 'sandbox not found' })
      },
      clientsAttached: async () => false,
      isMissing: isSandboxMissing,
      toFailure: asVercelFailure,
    })

    expect(result.probe).toBe(ESandboxProbe.Missing)
  })

  it('keeps a sandbox whose baked serve matches the pin', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })

    const result = await probeOf({ sandbox })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(sandbox.deleted()).toBe(false)
  })

  it('replaces a stale sandbox once the drive it held is free', async () => {
    const sandbox = fakeSandbox({ installed: '1.0.0' })
    let waits = 0

    const result = await probeOf({
      sandbox,
      waitForDriveDetached: async () => {
        waits += 1
        return true
      },
    })

    expect(sandbox.deleted()).toBe(true)
    expect(waits).toBe(1)
    expect(result.probe).toBe(ESandboxProbe.Replaced)
  })

  it('still replaces when the detach lag outlives the wait, logging the pending lag', async () => {
    const sandbox = fakeSandbox({ installed: '1.0.0' })
    const lines: string[] = []

    const result = await probeOf({ sandbox, waitForDriveDetached: async () => false, lines })

    expect(result.probe).toBe(ESandboxProbe.Replaced)
    expect(lines.some((line) => line.includes('drive is still attached'))).toBe(true)
  })

  it('keeps a stale sandbox a client is attached to, reporting the carried serve', async () => {
    const sandbox = fakeSandbox({ installed: '1.0.0' })

    const result = await probeSandboxForResume({
      name: 'atlas-thread-x',
      pinned: PINNED,
      timeoutMs: 5_000,
      servePort: 3000,
      fetch: async () => sandbox,
      clientsAttached: async () => true,
      isMissing: isSandboxMissing,
      toFailure: asVercelFailure,
    })

    expect(result.probe).toBe(ESandboxProbe.OutdatedAttached)
    expect(result.outdatedServe).toBe('1.0.0')
    expect(sandbox.deleted()).toBe(false)
  })

  it('reads a version file that names the pinned serve through the sandbox', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })
    let versionReads = 0
    const counting = Object.assign(sandbox, {
      runCommand: async (params: { args?: string[] }) => {
        expect(params.args?.[1]).toContain(SERVE_VERSION_PATH)
        versionReads += 1
        return { exitCode: 0, stdout: async () => `${PINNED}\n`, stderr: async () => '' }
      },
    })

    await probeOf({ sandbox: counting })

    expect(versionReads).toBe(1)
  })
})
