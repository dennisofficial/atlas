import type { Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire'
import { probeSandboxForResume, type ServeRuntimeHealth } from '../resume-probe'
import { asVercelFailure, isSandboxMissing } from '@dltech/atlas-wire'

export const PINNED = '2.0.0'

// Drain-capable but stale against the pin, so rotation specs exercise the drain gate rather than
// the pre-drain-protocol fast path (1.61.0 is the first version with /v1/drain).
export const STALE = '1.80.0'

export const FULL_IDLE: ServeRuntimeHealth = {
  busy: false,
  childrenRunning: 0,
  shellsRunning: 0,
  servicesRunning: 0,
  pendingInput: false,
  settlingWork: false,
  clients: 0,
}

export const fakeSandbox = (args: {
  installed: string
  protocol?: string
  status?: string
  routes?: number[]
  deleteFailure?: Error
}) => {
  const protocol = args.protocol ?? String(CHANNEL_PROTOCOL_VERSION)
  let deleted = false
  const routedPorts = args.routes ?? [3000]
  const base = {
    name: 'atlas-thread-x',
    status: args.status ?? 'running',
    runCommand: async () => ({
      exitCode: 0,
      stdout: async () => `${args.installed}\n${protocol}\n`,
      stderr: async () => '',
    }),
    domain: (port: number) => {
      if (!routedPorts.includes(port)) throw new Error('no route')
      return `https://sb-${port}.vercel.run`
    },
    delete: async () => {
      if (args.deleteFailure !== undefined) throw args.deleteFailure
      deleted = true
    },
  }
  const sandbox = base as unknown as Sandbox
  return Object.assign(sandbox, { deleted: () => deleted }) as Sandbox & {
    deleted: () => boolean
  }
}

export const probeOf = (args: {
  sandbox: Sandbox
  unpinned?: boolean
  health?: ServeRuntimeHealth | undefined
  healthThrows?: boolean
  serveAlive?: boolean
  waitForDriveDetached?: () => Promise<boolean>
  drain?: (args: { sandbox: Sandbox; url: string }) => Promise<void>
  swapServe?: (sandbox: Sandbox) => Promise<void>
  onRotationStarted?: () => void
  lines?: string[]
}) =>
  probeSandboxForResume({
    name: 'atlas-thread-x',
    pinned: args.unpinned === true ? undefined : PINNED,
    timeoutMs: 5_000,
    servePort: 3000,
    fetch: async () => args.sandbox,
    runtimeHealth: async () => {
      if (args.healthThrows === true) throw new Error('command unavailable')
      return args.health
    },
    serveAlive: async () => args.serveAlive !== false,
    ...(args.drain === undefined ? {} : { drain: args.drain }),
    ...(args.swapServe === undefined ? {} : { swapServe: args.swapServe }),
    ...(args.onRotationStarted === undefined ? {} : { onRotationStarted: args.onRotationStarted }),
    ...(args.waitForDriveDetached === undefined
      ? {}
      : { waitForDriveDetached: args.waitForDriveDetached }),
    log: args.lines === undefined ? undefined : (line) => args.lines?.push(line),
    isMissing: isSandboxMissing,
    toFailure: asVercelFailure,
  })

export const healthSandbox = (args: { body?: string; exitCode?: number; throws?: boolean }) => {
  const sandbox = {
    name: 'atlas-thread-x',
    runCommand: async () => {
      if (args.throws === true) throw new Error('command unavailable')
      return { exitCode: args.exitCode ?? 0, stdout: async () => args.body ?? '' }
    },
  }
  return sandbox as unknown as Sandbox
}
