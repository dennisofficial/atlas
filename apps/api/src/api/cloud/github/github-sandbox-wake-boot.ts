import { Logger } from '@nestjs/common'
import type { Sandbox } from '@vercel/sandbox'

import {
  createServeLauncher,
  imageOptimizeRetry,
  isSandboxMissing,
  liveSdk,
  mountWithRetries,
  routedUrlWithRetries,
  SANDBOX_QUICK_TIMEOUT_MS,
  settleRetry,
  type ServeLauncher,
  type VercelCredentials,
  type VercelSdk,
} from '@dltech/atlas-wire'

export type WakeBootArgs = {
  credentials: VercelCredentials
  name: string
  threadId: string
  image: string
  cloudUrl: string
  serveVersion: string | undefined
  freshToken: string
  resumeToken: string | undefined
  /** Runs before serve launches on a sandbox Vercel created fresh, so its first mirror authenticates. */
  onFreshSandbox: () => Promise<void>
}

export type WakeBootResult = { serveUrl: string; created: boolean }

export interface SandboxWakeBoot {
  boot(args: WakeBootArgs): Promise<WakeBootResult>
}

export const SANDBOX_WAKE_BOOT = Symbol('SANDBOX_WAKE_BOOT')

export const sandboxWakeBootProvider = {
  provide: SANDBOX_WAKE_BOOT,
  useFactory: (): SandboxWakeBoot =>
    new VercelSandboxWakeBoot({
      sdk: liveSdk,
      log: (line) => new Logger('VercelSandboxWakeBoot').log(line),
    }),
}

export const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export class ResumeTokenMissingError extends Error {
  constructor(name: string) {
    super(
      `sandbox ${name} resumed from its snapshot but its row holds no usable session token; refusing to mint over the live serve`,
    )
  }
}

/**
 * Resumes a parked sandbox from its snapshot and boots its serve at the pinned version. The
 * sandbox is never deleted: a resume reuses the row's session token, and only a sandbox Vercel
 * had to create fresh (past retention) runs under the freshly minted one.
 */
export class VercelSandboxWakeBoot implements SandboxWakeBoot {
  private readonly sdk: VercelSdk
  private readonly log: (line: string) => void
  private readonly launch: ServeLauncher

  constructor(deps: {
    sdk: VercelSdk
    log: (line: string) => void
    launch?: ServeLauncher | undefined
  }) {
    this.sdk = deps.sdk
    this.log = deps.log
    this.launch = deps.launch ?? createServeLauncher({ log: deps.log })
  }

  async boot(args: WakeBootArgs): Promise<WakeBootResult> {
    let created = false
    try {
      const sandbox = await mountWithRetries({
        sdk: this.sdk,
        cloudUrl: args.cloudUrl,
        retry: settleRetry,
        imageOptimize: imageOptimizeRetry,
        log: this.log,
        credentials: args.credentials,
        name: args.name,
        image: args.image,
        threadId: args.threadId,
        token: args.freshToken,
        onCreate: () => {
          created = true
          return Promise.resolve()
        },
      })
      if (created) await args.onFreshSandbox()
      const token = created ? args.freshToken : args.resumeToken
      if (token === undefined) throw new ResumeTokenMissingError(args.name)
      await this.launchServe({ sandbox, token, args })
      return { serveUrl: await routedUrlWithRetries(sandbox), created }
    } catch (failure) {
      if (created) await this.rollback(args)
      throw failure
    }
  }

  private async launchServe(args: { sandbox: Sandbox; token: string; args: WakeBootArgs }): Promise<void> {
    await this.launch({
      sandbox: args.sandbox,
      token: args.token,
      sandboxSessionId: args.sandbox.currentSession().sessionId,
      cloudUrl: args.args.cloudUrl,
      desiredVersion: args.args.serveVersion,
    })
  }

  /**
   * Only a sandbox this wake created is rolled back: a half-configured fresh sandbox would idle
   * into Vercel's reaper. Best-effort: a rollback failure must not mask the boot failure.
   */
  private async rollback(args: WakeBootArgs): Promise<void> {
    try {
      const leaked = await this.sdk
        .get({
          ...args.credentials,
          name: args.name,
          resume: false,
          signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
        })
        .catch((failure: unknown) => (isSandboxMissing(failure) ? undefined : Promise.reject(failure)))
      if (leaked === undefined) return
      await leaked.delete({ signal: AbortSignal.timeout(30_000) })
      this.log(`wake rolled back freshly created sandbox ${args.name} after its failed boot`)
    } catch (failure) {
      this.log(
        `wake rollback of ${args.name} failed — Vercel's idle reaper owns it: ${failureText(failure)}`,
      )
    }
  }
}
