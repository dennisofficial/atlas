import type { Sandbox } from '@vercel/sandbox'

import {
  settleRetry,
  imageOptimizeRetry,
  type RetryPolicy,
  createServeLauncher,
  type DevServeBinary,
  type DevServeResolver,
  type ServeInstaller,
  type ServeLauncher,
  uploadServeInstaller,
  liveSdk,
  assertLiveSession,
  observationOf,
  SANDBOX_QUICK_TIMEOUT_MS,
  type SandboxObservation,
  type SandboxPlacement,
  type VercelCredentials,
  type VercelSdk,
  asVercelFailure,
  isSandboxMissing,
  renewSessionDeadline,
  SandboxMissingError,
  type SandboxDeadlineObservation,
} from '@dltech/atlas-wire'
import { probeRuntimeActivity, type RuntimeActivityProbe } from './resume-probe'
import { tailServeLog, writeBootstrapFile } from './vercel-driver-probes'
import { provisionSandbox, type ProvisionArgs } from './vercel-driver-provision'

export class VercelDriver {
  private readonly sdk: VercelSdk
  private readonly inflightBySandboxName = new Map<string, Promise<unknown>>()
  private readonly runtimeActivity: RuntimeActivityProbe = probeRuntimeActivity
  private readonly settleRetry: RetryPolicy
  private readonly imageOptimizeRetry: RetryPolicy

  constructor(
    private readonly args: {
      credentials: VercelCredentials
      cloudUrl: string
      /** Only createOrResume boots one, so an exposure-only driver never names one. */
      image?: string | undefined
      /** Creation-time sandbox size, same contract as `VercelSandboxConfig.vcpus`. */
      vcpus?: number | undefined
      /** Same pin as `VercelSandboxConfig.serveVersion`; a direct driver construction names it here. */
      serveVersion?: string | undefined
      devServe?: DevServeResolver | undefined
      uploadServe?: ((binary: DevServeBinary) => ServeInstaller) | undefined
      timeoutMs?: number | undefined
      log?: ((line: string) => void) | undefined
      sdk?: VercelSdk | undefined
      /** The settle budget the mount's name-conflict retries run on; a spec passes zero delays. */
      settleRetry?: RetryPolicy | undefined
      /** Budget for waiting out a freshly published image's optimization lag. */
      imageOptimizeRetry?: RetryPolicy | undefined
      runtimeHealth?: RuntimeActivityProbe | undefined
    },
  ) {
    this.sdk = args.sdk ?? liveSdk
    this.settleRetry = args.settleRetry ?? settleRetry
    this.imageOptimizeRetry = args.imageOptimizeRetry ?? imageOptimizeRetry
    if (args.runtimeHealth !== undefined) this.runtimeActivity = args.runtimeHealth
  }

  createOrResume(args: ProvisionArgs): Promise<SandboxPlacement> {
    // Two wakes of the same thread in one process share one provision instead of racing; the
    // in-sandbox swap lock covers the cross-process case.
    return this.nameKeyed(args.name, async () => {
      const serve = await this.serveToProvision()
      return provisionSandbox(
        {
          config: { ...this.args, serveVersion: serve.version },
          sdk: this.sdk,
          runtimeHealth: this.runtimeActivity,
          settleRetry: this.settleRetry,
          imageOptimizeRetry: this.imageOptimizeRetry,
          launchServe: (launchArgs: Parameters<ServeLauncher>[0]) =>
            this.nameKeyed(`launch:${launchArgs.sandbox.name}`, () =>
              createServeLauncher({
                log: this.args.log,
                ...(serve.installServe === undefined ? {} : { installServe: serve.installServe }),
              })({
                sandbox: launchArgs.sandbox,
                ...(launchArgs.token === undefined ? {} : { token: launchArgs.token }),
                ...(launchArgs.cloudUrl === undefined ? {} : { cloudUrl: launchArgs.cloudUrl }),
                desiredVersion: launchArgs.desiredVersion ?? serve.version,
              }),
            ),
        },
        args,
      )
    })
  }

  private async serveToProvision(): Promise<{
    version: string | undefined
    installServe?: ServeInstaller
  }> {
    if (this.args.devServe === undefined) return { version: this.args.serveVersion }
    const binary = await this.args.devServe({ log: this.args.log })
    this.args.log?.(
      `dev serve ${binary.version} resolved — uploading it instead of downloading a release`,
    )
    return {
      version: binary.version,
      installServe: (this.args.uploadServe ?? uploadServeInstaller)(binary),
    }
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
   * The live allocation as Vercel reports it. Either field is undefined when the SDK's record
   * does not carry it — callers treat that as "unknown", not zero.
   */
  async readResources(args: { name: string }): Promise<{ vcpus?: number; memoryMb?: number }> {
    try {
      const sandbox = await this.sandboxNamed(args.name, { resume: false })
      return {
        ...(sandbox.vcpus === undefined ? {} : { vcpus: sandbox.vcpus }),
        ...(sandbox.memory === undefined ? {} : { memoryMb: sandbox.memory }),
      }
    } catch (failure) {
      if (isSandboxMissing(failure)) throw new SandboxMissingError(args.name)
      throw asVercelFailure(failure)
    }
  }

  async updateResources(args: { name: string; vcpus: number }): Promise<void> {
    try {
      const sandbox = await this.sandboxNamed(args.name)
      await sandbox.update(
        { resources: { vcpus: args.vcpus } },
        { signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) },
      )
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

  async renewDeadline(args: {
    name: string
    sessionId: string
    until: number
  }): Promise<SandboxDeadlineObservation> {
    try {
      const sandbox = await this.sandboxNamed(args.name, { resume: false })
      return await renewSessionDeadline({ sandbox, ...args })
    } catch (failure) {
      throw asVercelFailure(failure)
    }
  }

  /**
   * The serve log tail from a live sandbox, for a birth that stalled before serve went healthy.
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

  /**
   * The explicit sandbox delete: the TUI reaper past TTL and operator teardown. Wake, park and
   * drift never reach it — a sandbox is only ever resumed or swapped in place.
   */
  async destroy(args: { name: string; sessionId?: string | undefined }): Promise<void> {
    const fenced = args.sessionId !== undefined
    try {
      const sandbox = await this.sandboxNamed(args.name, fenced ? { resume: false } : undefined)
      assertLiveSession({ sandbox, name: args.name, expected: args.sessionId })
      await sandbox.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    } catch (failure) {
      if (!isSandboxMissing(failure)) throw asVercelFailure(failure)
      if (fenced) throw new SandboxMissingError(args.name)
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

  private nameKeyed<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inflightBySandboxName.get(key)
    if (existing !== undefined) return existing as Promise<T>
    const attempt = run().finally(() => {
      this.inflightBySandboxName.delete(key)
    })
    this.inflightBySandboxName.set(key, attempt)
    return attempt
  }
}
