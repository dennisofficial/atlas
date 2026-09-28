import type { Sandbox } from '@vercel/sandbox'
import { z } from 'zod'

import { SERVE_TOKEN_PATH, SERVE_VERSION_PATH } from './serve-launch'

export enum ESandboxProbe {
  Missing = 'missing',
  Kept = 'kept',
  Replaced = 'replaced',
  /**
   * Drift found but a client is still attached to the running serve, so the sandbox survives:
   * destroying it would cut a live session mid-conversation. The stale serve keeps running until
   * the sandbox's next cold boot, which recreates it from the pinned image.
   */
  OutdatedAttached = 'outdated-attached',
}

export type SandboxProbeResult = { probe: ESandboxProbe; outdatedServe?: string | undefined }

/** Attach detection for the drift probe, injectable so a spec never reaches HTTP. */
export type AttachProbe = (args: { sandbox: Sandbox; url: string }) => Promise<boolean>

const healthSchema = z.looseObject({ clients: z.number().optional() })

/**
 * The serve's own attach signal: `/v1/health` answers the count of attached channel sockets. The
 * probe runs against whatever serve is already up, authenticated with the token file the sandbox
 * itself holds — a health answer is truth, while a failed fetch (no route, no serve, a transient
 * error) reads as unattached because nothing can be shown to be attached.
 */
export const probeClientsAttached = async (args: {
  sandbox: Sandbox
  url: string
}): Promise<boolean> => {
  const health = await args.sandbox
    .runCommand({
      cmd: 'sh',
      args: [
        '-c',
        `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
          `curl -sf -m 5 --connect-timeout 2 -H "Authorization: Bearer $_serve_token" ` +
          `${args.url}/v1/health 2>/dev/null || true`,
      ],
      timeoutMs: 15_000,
    })
    .catch(() => null)
  if (health === null || health.exitCode !== 0) return false
  const text = (await health.stdout()).trim()
  if (text === '') return false
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return false
  }
  const parsed = healthSchema.safeParse(payload)
  return parsed.success && (parsed.data.clients ?? 0) > 0
}

const routedUrlOf = (sandbox: Sandbox, port: number): string | undefined => {
  try {
    return sandbox.domain(port)
  } catch {
    return undefined
  }
}

/**
 * The drift fix. `Sandbox.getOrCreate` resumes a live sandbox by name and never compares the
 * image, so a long-lived sandbox keeps whatever image it first booted from — stale against a
 * release that moved on. When this build pins a serve version, read the sandbox's installed
 * version file before resuming; a mismatch means the sandbox boots the wrong serve, so it is
 * destroyed and recreated from the pinned image — unless the health probe shows a client still
 * attached, in which case the stale serve keeps running and the recreate waits for the next cold
 * boot. The recreation is lossless where it matters: the workspace and transcript live on the
 * thread's drive, and the fresh boot carries the pinned serve baked into its image. A missing
 * version file is drift — the file ships with the image, so its absence means the sandbox predates
 * it — but a read that fails is not: a transient command failure is not evidence, and the sandbox
 * is left alone.
 *
 * Returns the probe outcome so the caller knows whether the upcoming boot is fresh: `missing`
 * when Vercel has never seen the name, `replaced` when drift forced a recreate, `kept` when a
 * live sandbox will be resumed, `outdated-attached` when a drifted sandbox survives because a
 * client is still attached to it.
 */
export async function probeSandboxForResume(args: {
  name: string
  pinned: string | undefined
  timeoutMs: number
  servePort: number
  fetch: () => Promise<Sandbox>
  clientsAttached: AttachProbe
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
  const url = routedUrlOf(sandbox, args.servePort)
  const attached =
    url === undefined
      ? false
      : await args.clientsAttached({ sandbox, url }).catch(() => false)
  if (attached) {
    args.log?.(
      `sandbox ${args.name} carries serve "${installedLabel}", this build wants "${pinned}", but a client is attached — keeping the older serve until its next cold boot`,
    )
    return { probe: ESandboxProbe.OutdatedAttached, outdatedServe: installed }
  }

  args.log?.(
    `sandbox ${args.name} carries serve "${installedLabel}", this build wants "${pinned}" — recreating it from the pinned image`,
  )
  await sandbox.delete({ signal: AbortSignal.timeout(args.timeoutMs) })
  return { probe: ESandboxProbe.Replaced }
}
