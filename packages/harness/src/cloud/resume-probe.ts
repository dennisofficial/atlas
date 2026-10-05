import type { Sandbox } from '@vercel/sandbox'
import { z } from 'zod'

import { CHANNEL_PROTOCOL_VERSION } from './channel-wire'
import { drainServe, type ServeDrain } from './serve-drain-client'
import { probeServeAlive, SERVE_PROTOCOL_PATH, SERVE_TOKEN_PATH, SERVE_VERSION_PATH } from './serve-launch'

export enum ESandboxProbe {
  Missing = 'missing',
  Kept = 'kept',
  Replaced = 'replaced',
  RotationNeeded = 'rotation-needed',
}

export const UNSTAMPED_PROTOCOL = 0

export type SandboxProbeResult = {
  probe: ESandboxProbe
  rotatedFrom?: string | undefined
  outdatedProtocol?: number | undefined
}

export enum ERuntimeIdle {
  Idle = 'idle',
  Busy = 'busy',
  Unknown = 'unknown',
}

export type ServeRuntimeHealth = {
  busy?: boolean | undefined
  turnRunning?: boolean | undefined
  childrenRunning?: number | undefined
  shellsRunning?: number | undefined
  servicesRunning?: number | undefined
  pendingInput?: boolean | undefined
  settlingWork?: boolean | undefined
  clients?: number | undefined
}

const runtimeHealthSchema = z.looseObject({
  busy: z.boolean().optional(),
  turnRunning: z.boolean().optional(),
  childrenRunning: z.number().optional(),
  shellsRunning: z.number().optional(),
  servicesRunning: z.number().optional(),
  pendingInput: z.boolean().optional(),
  settlingWork: z.boolean().optional(),
  clients: z.number().optional(),
})

export type RuntimeActivityProbe = (args: {
  sandbox: Sandbox
  url: string
}) => Promise<ServeRuntimeHealth | undefined>

export type ServeAliveProbe = (args: { sandbox: Sandbox }) => Promise<boolean>

export type DetachWait = () => Promise<boolean>

const GUARDED_FIELDS = [
  'busy',
  'childrenRunning',
  'shellsRunning',
  'servicesRunning',
  'pendingInput',
  'settlingWork',
  'clients',
] as const

const busyFieldOf = (health: ServeRuntimeHealth): string | undefined => {
  if (health.busy === true) return 'busy=true'
  if (health.turnRunning === true) return 'turnRunning=true'
  if ((health.childrenRunning ?? 0) > 0) return `childrenRunning=${health.childrenRunning}`
  if ((health.shellsRunning ?? 0) > 0) return `shellsRunning=${health.shellsRunning}`
  if ((health.servicesRunning ?? 0) > 0) return `servicesRunning=${health.servicesRunning}`
  if (health.pendingInput === true) return 'pendingInput=true'
  if (health.settlingWork === true) return 'settlingWork=true'
  if ((health.clients ?? 0) > 0) return `clients=${health.clients}`
  return undefined
}

const unreportedFieldsOf = (health: ServeRuntimeHealth): string[] =>
  GUARDED_FIELDS.filter((field) => health[field] === undefined)

const idleSummaryOf = (health: ServeRuntimeHealth): string =>
  GUARDED_FIELDS.map((field) => `${field}=${String(health[field])}`).join(' ')

export const runtimeIdleOf = (health: ServeRuntimeHealth | undefined): ERuntimeIdle => {
  if (health === undefined) return ERuntimeIdle.Unknown
  if (busyFieldOf(health) !== undefined) return ERuntimeIdle.Busy
  if (unreportedFieldsOf(health).length > 0) return ERuntimeIdle.Unknown
  return ERuntimeIdle.Idle
}

export const probeRuntimeActivity: RuntimeActivityProbe = async ({ sandbox, url }) => {
  const probe = await sandbox
    .runCommand({
      cmd: 'sh',
      args: [
        '-c',
        `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
          `curl -sf -m 5 --connect-timeout 2 -H "Authorization: Bearer $_serve_token" ` +
          `${url}/v1/health 2>/dev/null || true`,
      ],
      timeoutMs: 15_000,
    })
    .catch(() => null)
  if (probe === null || probe.exitCode !== 0) return undefined
  const text = (await probe.stdout()).trim()
  if (text === '') return undefined
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return undefined
  }
  const parsed = runtimeHealthSchema.safeParse(payload)
  if (!parsed.success) return undefined
  return parsed.data
}

const routedUrlOf = (sandbox: Sandbox, port: number): string | undefined => {
  try {
    return sandbox.domain(port)
  } catch {
    return undefined
  }
}

const protocolOf = (text: string | undefined): number => {
  const trimmed = text?.trim() ?? ''
  return /^\d+$/.test(trimmed) ? Number(trimmed) : UNSTAMPED_PROTOCOL
}

export enum EServeAge {
  Older = 'older',
  Same = 'same',
  Newer = 'newer',
  Unknown = 'unknown',
}

export const serveAgeOf = (args: { installed: string; pinned: string }): EServeAge => {
  const parse = (text: string): [number, number, number] | null => {
    const parts = text.trim().split('.')
    if (parts.length !== 3) return null
    const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
    const [major, minor, patch] = nums
    if (major === undefined || minor === undefined || patch === undefined) return null
    if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return null
    return [major, minor, patch]
  }
  const installed = parse(args.installed)
  const pinned = parse(args.pinned)
  if (installed === null || pinned === null) return EServeAge.Unknown
  for (const index of [0, 1, 2] as const) {
    const left = installed[index] ?? 0
    const right = pinned[index] ?? 0
    if (left < right) return EServeAge.Older
    if (left > right) return EServeAge.Newer
  }
  return EServeAge.Same
}

const notifyRotationStarted = (args: {
  onRotationStarted: (() => void) | undefined
  log: ((line: string) => void) | undefined
}): void => {
  try {
    args.onRotationStarted?.()
  } catch (failure) {
    args.log?.(`rotation notice callback threw: ${failure instanceof Error ? failure.message : String(failure)}`)
  }
}

export async function probeSandboxForResume(args: {
  name: string
  pinned: string | undefined
  timeoutMs: number
  servePort: number
  fetch: () => Promise<Sandbox>
  runtimeHealth: RuntimeActivityProbe
  serveAlive?: ServeAliveProbe | undefined
  waitForDriveDetached?: DetachWait | undefined
  drain?: ServeDrain | undefined
  onRotationStarted?: (() => void) | undefined
  log?: ((line: string) => void) | undefined
  isMissing: (failure: unknown) => boolean
  toFailure: (failure: unknown) => Error
}): Promise<SandboxProbeResult> {
  let sandbox: Sandbox
  try {
    sandbox = await args.fetch()
  } catch (failure) {
    if (args.isMissing(failure)) return { probe: ESandboxProbe.Missing }
    throw args.toFailure(failure)
  }

  // A delete racing the provider's own teardown is the delete's desired end state, not a failure.
  const deleteSandbox = async (victim: Sandbox): Promise<void> => {
    try {
      await victim.delete({ signal: AbortSignal.timeout(args.timeoutMs) })
    } catch (failure) {
      if (!args.isMissing(failure)) throw args.toFailure(failure)
      args.log?.(`sandbox ${args.name} was already gone when its delete ran — continuing`)
    }
  }

  const pinned = args.pinned
  const providerStatus = sandbox.status
  if (providerStatus === 'stopped') {
    if (pinned === undefined) return { probe: ESandboxProbe.Kept }
    args.log?.(`sandbox ${args.name} is confirmed stopped — recreating it from the pinned image without waking its old runtime`)
    await deleteSandbox(sandbox)
    const detached = await (args.waitForDriveDetached?.() ?? true)
    if (!detached) args.log?.(`sandbox ${args.name} deleted, but its drive is still attached — the recreate will retry through the lag`)
    return { probe: ESandboxProbe.Replaced }
  }
  if (providerStatus !== 'running' && providerStatus !== 'pending') {
    args.log?.(`sandbox ${args.name} runtime is ${providerStatus} — keeping it without executing a probe`)
    return { probe: ESandboxProbe.Kept }
  }

  const read = await sandbox
    .runCommand({
      cmd: 'sh',
      args: [
        '-c',
        `printf '%s\\n' "$(cat ${SERVE_VERSION_PATH} 2>/dev/null)"; printf '%s\\n' "$(cat ${SERVE_PROTOCOL_PATH} 2>/dev/null)"`,
      ],
      timeoutMs: args.timeoutMs,
    })
    .catch(() => null)
  if (read === null) return { probe: ESandboxProbe.Kept }
  const [versionLine, protocolLine] = (await read.stdout()).split('\n')
  const installed = (versionLine ?? '').trim()
  const installedProtocol = protocolOf(protocolLine)

  if (installedProtocol > CHANNEL_PROTOCOL_VERSION) {
    throw new Error(`the sandbox speaks newer wire protocol ${installedProtocol} — update Atlas before attaching; nothing was destroyed`)
  }

  const rotate = async (line: string): Promise<void> => {
    notifyRotationStarted({ onRotationStarted: args.onRotationStarted, log: args.log })
    args.log?.(line)
    const url = routedUrlOf(sandbox, args.servePort)
    if (url === undefined) {
      throw new Error(`sandbox ${args.name} has no preparation route — nothing was destroyed`)
    }
    const health = await args.runtimeHealth({ sandbox, url }).catch(() => undefined)
    const idle = runtimeIdleOf(health)
    if (idle === ERuntimeIdle.Idle) {
      args.log?.(`sandbox ${args.name} reports no work in flight — recreating without draining`)
    } else {
      const serveAlive = args.serveAlive ?? (({ sandbox: s }: { sandbox: Sandbox }) => probeServeAlive(s))
      const alive = idle === ERuntimeIdle.Unknown && (await serveAlive({ sandbox }))
      if (idle === ERuntimeIdle.Unknown && !alive) {
        args.log?.(`sandbox ${args.name}'s serve process is gone — nothing left to drain, recreating directly`)
      } else {
        await (args.drain ?? drainServe)({ sandbox, url })
      }
    }
    await deleteSandbox(sandbox)
    const detached = await (args.waitForDriveDetached?.() ?? true)
    if (!detached) args.log?.(`sandbox ${args.name} deleted, but its drive is still attached — the recreate will retry through the lag`)
  }

  if (installedProtocol !== CHANNEL_PROTOCOL_VERSION) {
    await rotate(
      `sandbox ${args.name} speaks wire protocol ${installedProtocol === UNSTAMPED_PROTOCOL ? 'none (unstamped)' : installedProtocol}, this build speaks ${CHANNEL_PROTOCOL_VERSION} — draining the old serve and recreating the sandbox from the pinned image`,
    )
    return { probe: ESandboxProbe.RotationNeeded, outdatedProtocol: installedProtocol }
  }

  if (pinned === undefined) return { probe: ESandboxProbe.Kept }
  if (installed === pinned) return { probe: ESandboxProbe.Kept }

  if (serveAgeOf({ installed, pinned }) === EServeAge.Newer) {
    args.log?.(
      `sandbox ${args.name} carries serve "${installed}", newer than this build's pinned "${pinned}" — keeping it`,
    )
    return { probe: ESandboxProbe.Kept }
  }

  await rotate(
    `sandbox ${args.name} carries serve "${installed === '' ? 'none' : installed}", outdated against this build's pinned "${pinned}" — draining the old serve and recreating the sandbox from the pinned image`,
  )
  return { probe: ESandboxProbe.RotationNeeded, rotatedFrom: installed }
}
