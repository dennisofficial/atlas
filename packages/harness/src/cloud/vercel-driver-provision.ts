import { randomBytes } from 'node:crypto'

import type { Sandbox } from '@vercel/sandbox'

import {
  detachThenDeleteDrive,
  driveExists,
  ensureDrive,
  waitForDriveDetached,
  type DriveSdk,
} from './drive-lifecycle'
import { driveNameFor } from './drive-names'
import { ESandboxProbe, probeSandboxForResume, type RuntimeActivityProbe } from './resume-probe'
import type { RetryPolicy } from './retry-policy'
import type { ServeLauncher } from './serve-launch'
import { mountWithRetries, type SettleWaitNotice } from './vercel-driver-mount'
import {
  routedUrlWithRetries,
  SANDBOX_QUICK_TIMEOUT_MS,
  SANDBOX_SERVE_PORT,
  stateOf,
  type SandboxPlacement,
  type VercelCredentials,
  type VercelSdk,
} from './vercel-driver-sdk'
import {
  asVercelFailure,
  failureTextOf,
  isSandboxMissing,
  SandboxMissingError,
  VercelFailure,
} from './vercel-errors'

/**
 * A failed wake leaves whatever it created unless someone puts it back: the sandbox idles into
 * Vercel's reaper and the drive keeps a workspace snapshot the next wake then treats as real.
 * Rolls back only what this call created — a pre-existing drive is the thread's workspace and a
 * pre-existing sandbox is the probe's decision, never this one's to remove. Best-effort: a
 * rollback failure must not mask the failure that caused it.
 */
async function rollbackProvision(
  deps: ProvisionDeps,
  args: { name: string; driveName: string; created: boolean; driveExisted: boolean },
): Promise<void> {
  try {
    if (args.created) {
      const sandbox = await deps.sdk
        .get({
          ...deps.config.credentials,
          name: args.name,
          resume: false,
          signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
        })
        .catch((lookup: unknown) => (isSandboxMissing(lookup) ? undefined : Promise.reject(lookup)))
      if (sandbox !== undefined) {
        await sandbox.delete({ signal: AbortSignal.timeout(30_000) })
        deps.config.log?.(`rolled back sandbox ${args.name}, created by the failed wake`)
      }
    }
    if (!args.driveExisted) {
      await detachThenDeleteDrive({
        sdk: deps.drives,
        credentials: deps.config.credentials,
        name: args.driveName,
        retry: deps.attachLagRetry,
      })
      deps.config.log?.(`rolled back drive ${args.driveName}, created by the failed wake`)
    }
  } catch (rollbackFailure) {
    deps.config.log?.(
      `rollback of sandbox ${args.name} failed (${failureTextOf(rollbackFailure)}) — Vercel's idle reaper owns the sandbox; the drive stays until the next wake takes it`,
    )
  }
}

export type ProvisionDeps = {
  config: {
    credentials: VercelCredentials
    cloudUrl: string
    image?: string | undefined
    serveVersion?: string | undefined
    timeoutMs?: number | undefined
    log?: ((line: string) => void) | undefined
  }
  sdk: VercelSdk
  drives: DriveSdk
  runtimeHealth: RuntimeActivityProbe
  attachLagRetry: RetryPolicy
  imageOptimizeRetry: RetryPolicy
  launchServe: ServeLauncher
}

export type ProvisionArgs = {
  name: string
  threadId: string
  /**
   * The session's serve token, minted on this machine when omitted — the claim's token is a
   * caller override from the bridge slice, which still owns the wire side of it.
   */
  token?: string | undefined
  pinnedModel?: string | undefined
  /**
   * Writes the session's bootstrap onto the drive. Runs after the sandbox exists (the drive is
   * mounted) and before serve launches, so serve finds the workspace spec and context archive on
   * its first read. Receives the live sandbox — on a fresh boot the name does not resolve until
   * getOrCreate returns, so the callback writes through the sandbox it is handed, not a lookup.
   */
  putContextOnFreshBoot?: ((sandbox: Sandbox) => Promise<void>) | undefined
  /**
   * Extra environment for the sandbox process, resolved by the caller at lift time — the
   * settings a cloud session should inherit from the operator's machine (the decision-model
   * URL, classifier mode, search backend). The sandbox is a fresh container with no local
   * settings files, so anything not handed here reads as its fallback there.
   */
  environment?: Record<string, string> | undefined
  onRotationStarted?: (() => void) | undefined
  /**
   * The mount is riding out a provider settle (a name the registry has not released, a drive not
   * yet detached). The wake narrates the wait so a long settle reads as what it is, not a stall.
   */
  onSettleWait?: ((notice: SettleWaitNotice) => void) | undefined
}

export async function provisionSandbox(deps: ProvisionDeps, args: ProvisionArgs): Promise<SandboxPlacement> {
  if (deps.config.image === undefined) {
    throw new Error('this driver was built for port exposure only, not for creating sandboxes')
  }
  const image = deps.config.image
  const serveToken = args.token ?? randomBytes(32).toString('hex')
  const createStartedAt = Date.now()
  let created = false
  // Defaults to the conservative answer: an unknown drive is treated as pre-existing, so a
  // rollback can never delete a drive this wake did not create.
  let driveExisted = true
  try {
    const { credentials } = deps.config
    const driveName = driveNameFor({ threadId: args.threadId })
    driveExisted = await driveExists({ sdk: deps.drives, credentials, name: driveName })
    const drive = await ensureDrive({ sdk: deps.drives, credentials, name: driveName, driveExisted })
    const { probe, rotatedFrom, outdatedProtocol } = await probeSandboxForResume({
      name: args.name,
      pinned: deps.config.serveVersion,
      timeoutMs: SANDBOX_QUICK_TIMEOUT_MS,
      servePort: SANDBOX_SERVE_PORT,
      fetch: () =>
        deps.sdk.get({
          ...credentials,
          name: args.name,
          resume: false,
          signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
        }),
      runtimeHealth: deps.runtimeHealth,
      waitForDriveDetached: () =>
        waitForDriveDetached({
          sdk: deps.drives,
          credentials,
          name: driveName,
          retry: deps.attachLagRetry,
        }),
      onRotationStarted: args.onRotationStarted,
      log: deps.config.log,
      isMissing: isSandboxMissing,
      toFailure: asVercelFailure,
      swapServe: async (live: Sandbox) => {
        await deps.launchServe({
          sandbox: live,
          token: serveToken,
          sandboxSessionId: live.currentSession().sessionId,
          cloudUrl: deps.config.cloudUrl,
          desiredVersion: deps.config.serveVersion,
        })
      },
    })
    const freshBoot =
      probe === ESandboxProbe.Missing ||
      probe === ESandboxProbe.Replaced ||
      probe === ESandboxProbe.RotationNeeded
    const sandbox = await mountWithRetries({
      sdk: deps.sdk,
      cloudUrl: deps.config.cloudUrl,
      timeoutMs: deps.config.timeoutMs,
      retry: deps.attachLagRetry,
      imageOptimize: deps.imageOptimizeRetry,
      log: deps.config.log,
      credentials,
      name: args.name,
      image,
      drive,
      driveName,
      threadId: args.threadId,
      token: serveToken,
      environment: args.environment,
      pinnedModel: args.pinnedModel,
      onCreate: () => {
        created = true
        return Promise.resolve()
      },
      ...(args.onSettleWait === undefined ? {} : { onSettleWait: args.onSettleWait }),
    })
    const createMs = Date.now() - createStartedAt
    if (args.putContextOnFreshBoot !== undefined) {
      await args.putContextOnFreshBoot(sandbox)
    }
    const serveStartedAt = Date.now()
    await deps.launchServe({
      sandbox,
      token: serveToken,
      sandboxSessionId: sandbox.currentSession().sessionId,
      cloudUrl: deps.config.cloudUrl,
    })
    deps.config.log?.(
      `sandbox ${args.name} provisioned: get-or-create ${createMs}ms, serve launch ${Date.now() - serveStartedAt}ms`,
    )
    return {
      sessionId: sandbox.currentSession().sessionId,
      url: await routedUrlWithRetries(sandbox),
      state: stateOf(sandbox.status),
      created,
      driveName,
      token: serveToken,
      ...(rotatedFrom === undefined ? {} : { rotatedFrom }),
      ...(outdatedProtocol === undefined ? {} : { rotatedProtocol: outdatedProtocol }),
    }
  } catch (failure) {
    await rollbackProvision(deps, {
      name: args.name,
      driveName: driveNameFor({ threadId: args.threadId }),
      created,
      driveExisted,
    })
    if (failure instanceof SandboxMissingError) throw failure
    if (failure instanceof VercelFailure) throw failure
    deps.config.log?.(
      `sandbox ${args.name} provision failed ${Date.now() - createStartedAt}ms in: ${failureTextOf(failure)}`,
    )
    throw asVercelFailure(failure)
  }
}
