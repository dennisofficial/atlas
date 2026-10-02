import type { Sandbox } from '@vercel/sandbox'

import { detachThenDeleteDrive, liveDriveSdk, type DriveSdk } from './drive-lifecycle'
import { driveNameFor } from './drive-names'
import { probeRuntimeActivity, type RuntimeActivityProbe } from './resume-probe'
import { attachLagRetry, type RetryPolicy } from './retry-policy'
import { createServeLauncher, type ServeLauncher } from './serve-launch'
import { tailServeLog, transcriptPresent, writeBootstrapFile } from './vercel-driver-probes'
import { provisionSandbox, type ProvisionArgs } from './vercel-driver-provision'
import {
  liveSdk,
  assertLiveSession,
  observationOf,
  SANDBOX_MAX_PORTS,
  SANDBOX_QUICK_TIMEOUT_MS,
  type SandboxObservation,
  type SandboxPlacement,
  type VercelCredentials,
  type VercelSdk,
} from './vercel-driver-sdk'
import { asVercelFailure, isSandboxMissing, SandboxMissingError } from './vercel-errors'
import {
  downloadWorkspaceArchive,
  releaseWorkspaceExport,
  uploadWorkspaceArchive,
} from './workspace-archive-transport'

export * from './vercel-driver-sdk'

/**
 * Everything Atlas needs from Vercel, driven with the operator's own token: the control plane
 * keeps the rendezvous rows and the credential brokering, and every sandbox call happens here.
 * Ported from apps/api's VercelSandboxClient with Nest stripped — drives, timeout extension and
 * park notification died with the server-side reaper.
 */
export class VercelDriver {
  private readonly sdk: VercelSdk
  private readonly inflightLaunches = new WeakMap<object, Promise<void>>()
  private readonly runtimeActivity: RuntimeActivityProbe = probeRuntimeActivity
  private readonly attachLagRetry: RetryPolicy

  private readonly drives: DriveSdk

  constructor(
    private readonly args: {
      credentials: VercelCredentials
      cloudUrl: string
      /** Only createOrResume boots one, so an exposure-only driver never names one. */
      image?: string | undefined
      /** Same pin as `VercelSandboxConfig.serveVersion`; a direct driver construction names it here. */
      serveVersion?: string | undefined
      timeoutMs?: number | undefined
      log?: ((line: string) => void) | undefined
      sdk?: VercelSdk | undefined
      driveSdk?: DriveSdk | undefined
      /** The attach-detach lag budget the delete and mount retries share; a spec passes zero delays. */
      attachLagRetry?: RetryPolicy | undefined
      runtimeHealth?: RuntimeActivityProbe | undefined
    },
  ) {
    this.sdk = args.sdk ?? liveSdk
    this.drives = args.driveSdk ?? liveDriveSdk
    this.attachLagRetry = args.attachLagRetry ?? attachLagRetry
    if (args.runtimeHealth !== undefined) this.runtimeActivity = args.runtimeHealth
  }

  createOrResume(args: ProvisionArgs): Promise<SandboxPlacement> {
    return provisionSandbox(
      {
        config: this.args,
        sdk: this.sdk,
        drives: this.drives,
        runtimeHealth: this.runtimeActivity,
        attachLagRetry: this.attachLagRetry,
        launchServe: (launchArgs: Parameters<ServeLauncher>[0]) =>
          this.dedupedLaunch({
            sandbox: launchArgs.sandbox,
            launch: createServeLauncher({ log: this.args.log }),
            token: launchArgs.token,
            sandboxSessionId: launchArgs.sandboxSessionId,
            cloudUrl: launchArgs.cloudUrl,
          }),
      },
      args,
    )
  }

  /**
   * `undefined` when Vercel has never heard of the name — distinct from parked, which is a sandbox
   * with a snapshot to resume from. Callers use the difference to tell whether a wake needs the
   * context archive uploaded again.
   */
  async inspect(args: { name: string }): Promise<SandboxObservation | undefined> {
    try {
      const sandbox = await this.sandboxNamed(args.name, { resume: false })
      return observationOf(sandbox)
    } catch (failure) {
      if (isSandboxMissing(failure)) return undefined
      throw asVercelFailure(failure)
    }
  }

  /**
   * `update` replaces the whole port list, so the already-routed ports go back in alongside the
   * new one — omitting them would deregister the serve port and cut the session's own channel.
   */
  async exposePort(args: { name: string; port: number }): Promise<string> {
    try {
      const sandbox = await this.sandboxNamed(args.name)
      const routed = sandbox.routes.map((route) => route.port)
      if (!routed.includes(args.port)) {
        if (routed.length >= SANDBOX_MAX_PORTS) {
          throw new Error(
            `a sandbox exposes at most ${SANDBOX_MAX_PORTS} ports and this one is at the limit`,
          )
        }
        await sandbox.update(
          { ports: [...routed, args.port] },
          { signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) },
        )
      }
      return sandbox.domain(args.port)
    } catch (failure) {
      if (isSandboxMissing(failure)) throw new SandboxMissingError(args.name)
      throw asVercelFailure(failure)
    }
  }

  async stop(args: { name: string; sessionId?: string | undefined }): Promise<void> {
    try {
      const sandbox = await this.sandboxNamed(args.name, { resume: false })
      assertLiveSession({ sandbox, name: args.name, expected: args.sessionId })
      await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw asVercelFailure(failure)
    }
  }

  /**
   * The serve log tail from a live sandbox, for a lift that stalled before serve went healthy.
   * Answers the log's last bytes, or a marker when the sandbox or the log is not there to read.
   */
  async serveLogTail(args: { name: string }): Promise<string> {
    try {
      const sandbox = await this.sandboxNamed(args.name)
      return await tailServeLog(sandbox)
    } catch (failure) {
      if (isSandboxMissing(failure)) return '<the sandbox is gone>'
      throw asVercelFailure(failure)
    }
  }

  /**
   * Writes one bootstrap file into the directory serve reads at boot (`<ATLAS_HOME>/bootstrap`).
   * The laptop authors these — the workspace spec, the context and transcript archives — so the
   * sandbox boots off the drive with no control-plane round-trip. Buffering the bytes in memory is
   * safe here: this runs on the operator's machine, not a capped container (the #485 OOM was the
   * API doing this server-side).
   *
   * Takes the live sandbox rather than re-fetching by name: the bootstrap must be writable before
   * serve launches, and on a fresh boot the name does not resolve until `getOrCreate` returns.
   */
  async writeBootstrapFileToSandbox(args: {
    sandbox: Sandbox
    path: string
    content: Uint8Array | string
  }): Promise<void> {
    try {
      await writeBootstrapFile(args)
    } catch (failure) {
      throw asVercelFailure(failure)
    }
  }

  /**
   * Writes one bootstrap file into the directory serve reads at boot (`<ATLAS_HOME>/bootstrap`),
   * resolving the sandbox by name. Used by the post-boot surface (the lift's transcript ship),
   * where the sandbox already exists; the create path uses `writeBootstrapFileToSandbox` instead.
   */
  async writeBootstrapFile(args: {
    name: string
    path: string
    content: Uint8Array | string
  }): Promise<void> {
    try {
      const sandbox = await this.sandboxNamed(args.name)
      await this.writeBootstrapFileToSandbox({
        sandbox,
        path: args.path,
        content: args.content,
      })
    } catch (failure) {
      throw asVercelFailure(failure)
    }
  }

  async uploadWorkspaceArchive(args: {
    sandbox: Sandbox
    source: string
    destination: string
  }): Promise<void> {
    await this.guarded(args.sandbox.name, () => uploadWorkspaceArchive(args))
  }

  async downloadWorkspaceArchive(args: {
    name: string
    path: string
    destination: string
  }): Promise<void> {
    await this.guarded(args.name, async () => {
      const sandbox = await this.sandboxNamed(args.name)
      await downloadWorkspaceArchive({ sandbox, path: args.path, destination: args.destination })
    })
  }

  async releaseWorkspaceArchive(args: { name: string; path: string }): Promise<void> {
    try {
      await releaseWorkspaceExport({ sandbox: await this.sandboxNamed(args.name), path: args.path })
    } catch (failure) {
      if (!isSandboxMissing(failure)) throw asVercelFailure(failure)
    }
  }

  /** True once the transcript archive the laptop wrote is present on the drive. */
  async transcriptLanded(args: { name: string }): Promise<boolean> {
    try {
      const sandbox = await this.sandboxNamed(args.name)
      return await transcriptPresent(sandbox)
    } catch (failure) {
      if (isSandboxMissing(failure)) return false
      throw asVercelFailure(failure)
    }
  }

  async destroy(args: { name: string; threadId?: string | undefined }): Promise<void> {
    try {
      const sandbox = await this.sandboxNamed(args.name)
      await sandbox.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (!isSandboxMissing(failure)) throw asVercelFailure(failure)
    }
    if (args.threadId !== undefined) {
      const driveName = driveNameFor({ threadId: args.threadId })
      const detached = await detachThenDeleteDrive({
        sdk: this.drives,
        credentials: this.args.credentials,
        name: driveName,
        retry: this.attachLagRetry,
      })
      if (!detached) {
        this.args.log?.(
          `drive ${driveName} still read attached when its delete ran — the delete's retry waited out the detach`,
        )
      }
    }
  }

  private async guarded(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (failure) {
      if (isSandboxMissing(failure)) throw new SandboxMissingError(name)
      throw asVercelFailure(failure)
    }
  }

  private sandboxNamed(name: string, opts?: { resume: false }): Promise<Sandbox> {
    return this.sdk.get({
      ...this.args.credentials,
      name,
      ...(opts ?? {}),
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
  }

  private dedupedLaunch(args: {
    sandbox: Sandbox
    launch: ServeLauncher
    token?: string | undefined
    sandboxSessionId?: string | undefined
    cloudUrl?: string | undefined
  }): Promise<void> {
    const existing = this.inflightLaunches.get(args.sandbox)
    if (existing !== undefined) return existing
    const attempt = args
      .launch({
        sandbox: args.sandbox,
        ...(args.token === undefined ? {} : { token: args.token }),
        ...(args.sandboxSessionId === undefined ? {} : { sandboxSessionId: args.sandboxSessionId }),
        ...(args.cloudUrl === undefined ? {} : { cloudUrl: args.cloudUrl }),
      })
      .finally(() => {
        this.inflightLaunches.delete(args.sandbox)
      })
    this.inflightLaunches.set(args.sandbox, attempt)
    return attempt
  }
}
