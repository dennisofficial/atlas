import { Logger } from '@nestjs/common'

import {
  settleRetry,
  imageOptimizeRetry,
  createServeLauncher,
  isSandboxMissing,
  liveSdk,
  mountWithRetries,
  routedUrlWithRetries,
  SANDBOX_QUICK_TIMEOUT_MS,
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
 * Recreates a parked sandbox and boots its serve: the stopped Vercel sandbox is deleted and a
 * fresh container boots in its place, and serve comes up under a freshly minted token. The
 * delete+recreate semantics predate the driveless rebuild; the API-side wake rewrite (slice 5)
 * replaces this with a plain `resume: true` mount. Slice 2 only cut the drive machinery out of
 * it, so `driveName` rides along unused until then.
 */
class VercelSandboxWakeBoot implements SandboxWakeBoot {
  constructor(private readonly log: (line: string) => void) {}

  async boot(args: WakeBootArgs): Promise<WakeBootResult> {
    let created = false
    try {
      created = await this.replaceStaleSandbox(args)
      const sandbox = await mountWithRetries({
        sdk: liveSdk,
        cloudUrl: args.cloudUrl,
        retry: settleRetry,
        imageOptimize: imageOptimizeRetry,
        log: this.log,
        credentials: args.credentials,
        name: args.name,
        image: args.image,
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
   * the next wake's stale-delete can race the replacement. Best-effort: a rollback failure must
   * not mask the boot failure that caused it.
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
