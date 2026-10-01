import type { Sandbox } from '@vercel/sandbox'
import { z } from 'zod'

import { SERVE_TOKEN_PATH, SERVE_VERSION_PATH } from './serve-launch'

export enum ESandboxProbe {
  Missing = 'missing',
  Kept = 'kept',
  Replaced = 'replaced',
  OutdatedPreserved = 'outdated-preserved',
}

export type SandboxProbeResult = { probe: ESandboxProbe; outdatedServe?: string | undefined }

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

export async function probeSandboxForResume(args: {
  name: string
  pinned: string | undefined
  timeoutMs: number
  servePort: number
  fetch: () => Promise<Sandbox>
  runtimeHealth: RuntimeActivityProbe
  waitForDriveDetached?: DetachWait | undefined
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

  const pinned = args.pinned
  if (pinned === undefined) return { probe: ESandboxProbe.Kept }

  const read = await sandbox
    .runCommand({
      cmd: 'sh',
      args: ['-c', `cat ${SERVE_VERSION_PATH} 2>/dev/null || true`],
      timeoutMs: args.timeoutMs,
    })
    .catch(() => null)
  if (read === null) return { probe: ESandboxProbe.Kept }
  const installed = (await read.stdout()).trim()
  if (installed === pinned) return { probe: ESandboxProbe.Kept }

  const installedLabel = installed === '' ? 'none' : installed
  const preserve = (reason: string): SandboxProbeResult => {
    args.log?.(
      `sandbox ${args.name} carries serve "${installedLabel}", this build wants "${pinned}", but its runtime never proved idle (${reason}) — keeping the older serve until the sandbox parks cleanly`,
    )
    return { probe: ESandboxProbe.OutdatedPreserved, outdatedServe: installed }
  }

  if (sandbox.status !== 'stopped') {
    return preserve(`the provider reports it ${sandbox.status}`)
  }

  const url = routedUrlOf(sandbox, args.servePort)
  if (url === undefined) return preserve('it has no routed URL to read its health through')

  const health = await args.runtimeHealth({ sandbox, url }).catch(() => undefined)
  if (health === undefined) return preserve('its health could not be read')

  const idle = runtimeIdleOf(health)
  if (idle === ERuntimeIdle.Busy) return preserve(`${busyFieldOf(health) ?? 'busy'}; ${idleSummaryOf(health)}`)
  if (idle === ERuntimeIdle.Unknown) {
    return preserve(`health fields unreported: ${unreportedFieldsOf(health).join(', ')}`)
  }

  args.log?.(
    `sandbox ${args.name} carries serve "${installedLabel}", this build wants "${pinned}" and its runtime proved idle (${idleSummaryOf(health)}) — recreating it from the pinned image`,
  )
  await sandbox.delete({ signal: AbortSignal.timeout(args.timeoutMs) })
  const detached = await (args.waitForDriveDetached?.() ?? true)
  if (!detached) {
    args.log?.(
      `sandbox ${args.name} deleted, but its drive is still attached — the recreate will retry through the lag`,
    )
  }
  return { probe: ESandboxProbe.Replaced }
}
