import { randomBytes } from 'node:crypto'

import type { Sandbox } from '@vercel/sandbox'

import {
  type RetryPolicy,
  type ServeLauncher,
  mountWithRetries,
  type SettleWaitNotice,
  routedUrlWithRetries,
  SANDBOX_QUICK_TIMEOUT_MS,
  SANDBOX_SERVE_PORT,
  stateOf,
  type SandboxPlacement,
  type VercelCredentials,
  type VercelSdk,
  asVercelFailure,
  failureTextOf,
  isSandboxMissing,
  SandboxMissingError,
  VercelFailure,
} from '@dltech/atlas-wire'
import { ESandboxProbe, probeSandboxForResume, type RuntimeActivityProbe } from './resume-probe'

/**
 * A failed wake leaves the sandbox it created unless someone puts it back. Rolls back only what
 * this call created — a pre-existing sandbox is the probe's decision, never this one's to remove.
 * Best-effort: a rollback failure must not mask the failure that caused it.
 */
async function rollbackProvision(
  deps: ProvisionDeps,
  args: { name: string; created: boolean },
): Promise<void> {
  if (!args.created) return
  try {
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
  } catch (rollbackFailure) {
    deps.config.log?.(
      `rollback of sandbox ${args.name} failed (${failureTextOf(rollbackFailure)}) — Vercel's idle reaper owns it`,
    )
  }
}

export type ProvisionDeps = {
  config: {
    credentials: VercelCredentials
    cloudUrl: string
    image?: string | undefined
    vcpus?: number | undefined
    serveVersion?: string | undefined
    timeoutMs?: number | undefined
    log?: ((line: string) => void) | undefined
  }
  sdk: VercelSdk
  runtimeHealth: RuntimeActivityProbe
  settleRetry: RetryPolicy
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
   * Writes the session's bootstrap onto the sandbox filesystem. Runs after the sandbox exists and
   * before serve launches, so serve finds the workspace spec and context archive on its first
   * read. Receives the live sandbox — on a fresh boot the name does not resolve until getOrCreate
   * returns, so the callback writes through the sandbox it is handed, not a lookup.
   */
  putContextOnFreshBoot?: ((sandbox: Sandbox) => Promise<void>) | undefined
  /**
   * Extra environment for the sandbox process, resolved by the caller at birth time — the
   * settings a cloud session should inherit from the operator's machine (the decision-model
   * URL, classifier mode, search backend). The sandbox is a fresh container with no local
   * settings files, so anything not handed here reads as its fallback there.
   */
  environment?: Record<string, string> | undefined
  onRotationStarted?: (() => void) | undefined
  /**
   * The mount is riding out a provider settle (a name the registry has not released). The wake
   * narrates the wait so a long settle reads as what it is, not a stall.
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
  try {
    const { credentials } = deps.config
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
    const freshBoot = probe === ESandboxProbe.Missing
    const sandbox = await mountWithRetries({
      sdk: deps.sdk,
      cloudUrl: deps.config.cloudUrl,
      timeoutMs: deps.config.timeoutMs,
      retry: deps.settleRetry,
      imageOptimize: deps.imageOptimizeRetry,
      log: deps.config.log,
      credentials,
      name: args.name,
      image,
      vcpus: deps.config.vcpus,
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
      token: serveToken,
      ...(rotatedFrom === undefined ? {} : { rotatedFrom }),
      ...(outdatedProtocol === undefined ? {} : { rotatedProtocol: outdatedProtocol }),
    }
  } catch (failure) {
    await rollbackProvision(deps, { name: args.name, created })
    if (failure instanceof SandboxMissingError) throw failure
    if (failure instanceof VercelFailure) throw failure
    deps.config.log?.(
      `sandbox ${args.name} provision failed ${Date.now() - createStartedAt}ms in: ${failureTextOf(failure)}`,
    )
    throw asVercelFailure(failure)
  }
}
