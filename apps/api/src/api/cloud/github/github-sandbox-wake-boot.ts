import { Logger } from '@nestjs/common'

import {
  attachLagRetry,
  imageOptimizeRetry,
  createServeLauncher,
  ensureDrive,
  isSandboxMissing,
  liveDriveSdk,
  liveSdk,
  mountWithRetries,
  routedUrlWithRetries,
  SANDBOX_QUICK_TIMEOUT_MS,
  waitForDriveDetached,
  type VercelCredentials,
} from '@dltech/atlas-wire'

export type WakeBootArgs = {
  credentials: VercelCredentials
  name: string
  driveName: string
  threadId: string
  image: string
  cloudUrl: string
  serveVersion: string | undefined
  token: string
}

export type WakeBootResult = { serveUrl: string }

export interface SandboxWakeBoot {
  boot(args: WakeBootArgs): Promise<WakeBootResult>
}

export const SANDBOX_WAKE_BOOT = Symbol('SANDBOX_WAKE_BOOT')

export const sandboxWakeBootProvider = {
  provide: SANDBOX_WAKE_BOOT,
  useFactory: (): SandboxWakeBoot =>
    new VercelSandboxWakeBoot((line) => new Logger('VercelSandboxWakeBoot').log(line)),
}

export const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Recreates a parked sandbox and boots its serve: the stopped Vercel sandbox is deleted, the
 * thread's drive remounts on a fresh container, and serve comes up under a freshly minted token.
 * The row's sealedToken died at park, so the wake mints a new one and seals it onto the row —
 * the session's reconnect path verifies the same token the boot wrote into the sandbox.
 */
class VercelSandboxWakeBoot implements SandboxWakeBoot {
  constructor(private readonly log: (line: string) => void) {}

  async boot(args: WakeBootArgs): Promise<WakeBootResult> {
    let created = false
    try {
      created = await this.replaceStaleSandbox(args)
      await waitForDriveDetached({
        sdk: liveDriveSdk,
        credentials: args.credentials,
        name: args.driveName,
        retry: attachLagRetry,
      })
      const drive = await ensureDrive({
        sdk: liveDriveSdk,
        credentials: args.credentials,
        name: args.driveName,
        driveExisted: true,
      })
      const sandbox = await mountWithRetries({
        sdk: liveSdk,
        cloudUrl: args.cloudUrl,
        retry: attachLagRetry,
        imageOptimize: imageOptimizeRetry,
        log: this.log,
        credentials: args.credentials,
        name: args.name,
        image: args.image,
        drive,
        driveName: args.driveName,
        threadId: args.threadId,
        token: args.token,
        onCreate: () => {
          created = true
          return Promise.resolve()
        },
      })
      await this.launchServe({ sandbox, args })
      return { serveUrl: await routedUrlWithRetries(sandbox) }
    } catch (failure) {
      await this.rollback({ args, created })
      throw failure
    }
  }

  private async replaceStaleSandbox(args: WakeBootArgs): Promise<boolean> {
    const stale = await liveSdk
      .get({
        ...args.credentials,
        name: args.name,
        resume: false,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      .catch((failure: unknown) => (isSandboxMissing(failure) ? undefined : Promise.reject(failure)))
    if (stale === undefined) return false
    await stale.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
    this.log(`wake deleted parked sandbox ${args.name} before recreating it`)
    return true
  }

  private async launchServe(args: {
    sandbox: Awaited<ReturnType<typeof mountWithRetries>>
    args: WakeBootArgs
  }): Promise<void> {
    const launch = createServeLauncher({ log: this.log })
    try {
      await launch({
        sandbox: args.sandbox,
        token: args.args.token,
        cloudUrl: args.args.cloudUrl,
        desiredVersion: args.args.serveVersion,
      })
    } catch (failure) {
      if (args.args.serveVersion === undefined) throw failure
      this.log(
        `serve install of pinned ${args.args.serveVersion} failed on ${args.args.name} — retrying with latest: ${failureText(failure)}`,
      )
      await launch({
        sandbox: args.sandbox,
        token: args.args.token,
        cloudUrl: args.args.cloudUrl,
        desiredVersion: undefined,
      })
    }
  }

  /**
   * A failed wake must delete the sandbox it created: leaving it idles into Vercel's reaper and
   * the next wake's stale-delete can race the replacement. The drive is the thread's workspace —
   * it stays. Best-effort: a rollback failure must not mask the boot failure that caused it.
   */
  private async rollback(args: { args: WakeBootArgs; created: boolean }): Promise<void> {
    if (!args.created) return
    try {
      const leaked = await liveSdk
        .get({
          ...args.args.credentials,
          name: args.args.name,
          resume: false,
          signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
        })
        .catch((failure: unknown) => (isSandboxMissing(failure) ? undefined : Promise.reject(failure)))
      if (leaked === undefined) return
      await leaked.delete({ signal: AbortSignal.timeout(30_000) })
      this.log(`wake rolled back sandbox ${args.args.name} after its failed boot`)
    } catch (failure) {
      this.log(
        `wake rollback of ${args.args.name} failed — Vercel's idle reaper owns it: ${failureText(failure)}`,
      )
    }
  }
}
