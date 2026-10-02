import { randomBytes } from 'node:crypto'

import type { Sandbox } from '@vercel/sandbox'

import {
  ensureDrive,
  waitForDriveDetached,
  type DriveSdk,
} from './drive-lifecycle'
import { driveNameFor } from './drive-names'
import { ESandboxProbe, probeSandboxForResume, type RuntimeActivityProbe } from './resume-probe'
import type { RetryPolicy } from './retry-policy'
import type { ServeLauncher } from './serve-launch'
import { mountWithRetries } from './vercel-driver-mount'
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
}

export async function provisionSandbox(deps: ProvisionDeps, args: ProvisionArgs): Promise<SandboxPlacement> {
  if (deps.config.image === undefined) {
    throw new Error('this driver was built for port exposure only, not for creating sandboxes')
  }
  const image = deps.config.image
  const serveToken = args.token ?? randomBytes(32).toString('hex')
  const createStartedAt = Date.now()
  let created = false
  try {
    const { credentials } = deps.config
    const driveName = driveNameFor({ threadId: args.threadId })
    const drive = await ensureDrive({ sdk: deps.drives, credentials, name: driveName })
    const { probe, outdatedServe } = await probeSandboxForResume({
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
      log: deps.config.log,
      isMissing: isSandboxMissing,
      toFailure: asVercelFailure,
    })
    const freshBoot = probe === ESandboxProbe.Missing || probe === ESandboxProbe.Replaced
    const sandbox = await mountWithRetries({
      sdk: deps.sdk,
      cloudUrl: deps.config.cloudUrl,
      timeoutMs: deps.config.timeoutMs,
      retry: deps.attachLagRetry,
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
      ...(outdatedServe === undefined ? {} : { outdatedServe }),
    }
  } catch (failure) {
    if (failure instanceof SandboxMissingError) throw failure
    if (failure instanceof VercelFailure) throw failure
    deps.config.log?.(
      `sandbox ${args.name} provision failed ${Date.now() - createStartedAt}ms in: ${failureTextOf(failure)}`,
    )
    throw asVercelFailure(failure)
  }
}
