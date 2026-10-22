import type { Sandbox } from '@vercel/sandbox'

import { retrySleep, type RetryPolicy } from './sandbox-retry.js'
import {
  SANDBOX_LAUNCH_TIMEOUT_MS,
  SANDBOX_REGION,
  SANDBOX_SERVE_PORT,
  SANDBOX_TIMEOUT_MS,
  type VercelCredentials,
  type VercelSdk,
} from './sandbox-sdk.js'
import {
  EVercelFailure,
  failureTextOf,
  isImageNotFound,
  isImageOptimizeFailure,
  isImageOptimizeLag,
  isSandboxMissing,
  isSandboxNameConflict,
  VercelFailure,
} from './sandbox-errors.js'
import { SANDBOX_HOME_PATH } from './serve-env.js'

/** Which provider settle the mount is riding out, so the wake can narrate the wait truthfully. */
export enum ESettleWait {
  NameConflict = 'name-conflict',
}

export type SettleWaitNotice = {
  reason: ESettleWait
  attempt: number
  attempts: number
}

export async function mountWithRetries(args: {
  sdk: VercelSdk
  cloudUrl: string
  timeoutMs?: number | undefined
  retry: RetryPolicy
  imageOptimize: RetryPolicy
  log?: ((line: string) => void) | undefined
  credentials: VercelCredentials
  name: string
  image: string
  /** Creation-time size; undefined leaves Vercel's default (2 vCPU). Ignored by Vercel on resume. */
  vcpus?: number | undefined
  threadId: string
  token: string
  environment?: Record<string, string> | undefined
  /** False for an API-provisioned sandbox: its pod must never read the workspace's Vercel token. */
  injectVercelCredentials?: boolean | undefined
  pinnedModel?: string | undefined
  onCreate: () => Promise<void>
  onSettleWait?: ((notice: SettleWaitNotice) => void) | undefined
}): Promise<Sandbox> {
  for (let attempt = 1, optimizeWaits = 0; ; attempt++) {
    try {
      return await args.sdk.getOrCreate({
        ...args.credentials,
        name: args.name,
        ports: [SANDBOX_SERVE_PORT],
        timeout: args.timeoutMs ?? SANDBOX_TIMEOUT_MS,
        region: SANDBOX_REGION,
        persistent: true,
        resume: true,
        image: args.image,
        ...(args.vcpus === undefined ? {} : { resources: { vcpus: args.vcpus } }),
        onCreate: args.onCreate,
        env: {
          ATLAS_SERVE_TOKEN: args.token,
          ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
          ATLAS_THREAD_ID: args.threadId,
          ATLAS_CLOUD_URL: args.cloudUrl,
          ATLAS_HOME: SANDBOX_HOME_PATH,
          ...(args.injectVercelCredentials === false
            ? {}
            : {
                VERCEL_TOKEN: args.credentials.token,
                VERCEL_TEAM_ID: args.credentials.teamId,
                VERCEL_PROJECT_ID: args.credentials.projectId,
              }),
          ...(args.pinnedModel === undefined ? {} : { ATLAS_MODEL: args.pinnedModel }),
          ...args.environment,
        },
        signal: AbortSignal.timeout(SANDBOX_LAUNCH_TIMEOUT_MS),
      })
    } catch (failure) {
      if (isImageNotFound(failure)) {
        throw new VercelFailure({
          kind: EVercelFailure.ImageNotFound,
          message:
            `sandbox image ${args.image} is not published. Update Atlas — a release that cannot ` +
            `find its own image was cut before its image landed. If you override the image in ` +
            `settings, check the name.`,
        })
      }
      if (isImageOptimizeFailure(failure)) {
        throw new VercelFailure({
          kind: EVercelFailure.ImageOptimize,
          message:
            `sandbox image ${args.image} failed Vercel's optimization, and Vercel pins that ` +
            `failure to the published digest — waiting cannot fix it. Re-running the release's ` +
            `sandbox-image retag publishes the same tag under a fresh digest.`,
        })
      }
      if (isImageOptimizeLag(failure)) {
        optimizeWaits += 1
        if (optimizeWaits > args.imageOptimize.attempts) {
          throw new VercelFailure({
            kind: EVercelFailure.Unknown,
            message: `sandbox ${args.name} still waiting on Vercel to optimize image ${args.image} after ${args.imageOptimize.attempts} retries`,
          })
        }
        args.log?.(
          `Vercel is still optimizing image ${args.image} (wait ${optimizeWaits}/${args.imageOptimize.attempts})`,
        )
        await retrySleep(args.imageOptimize)
        continue
      }
      // Vercel can report a sandbox's name gone mid-create while its registry is still settling;
      // the retry budget rides out that settle.
      if (isSandboxMissing(failure)) {
        if (attempt >= args.retry.attempts) {
          throw new VercelFailure({
            kind: EVercelFailure.Unknown,
            message: `sandbox ${args.name} stayed missing through ${args.retry.attempts} attempts to resume or create it: ${failureTextOf(failure)}`,
          })
        }
        args.log?.(
          `Vercel reported sandbox ${args.name} missing mid-wake (attempt ${attempt}/${args.retry.attempts}) — waiting for the provider to settle`,
        )
        await retrySleep(args.retry)
        continue
      }
      // The mirror race: the probe saw the name free and the create 400s because the name
      // registry has not caught up. Same settle, same budget.
      if (isSandboxNameConflict(failure)) {
        if (attempt >= args.retry.attempts) {
          throw new VercelFailure({
            kind: EVercelFailure.NameConflict,
            message: `sandbox ${args.name}'s name stayed taken through ${args.retry.attempts} attempts to resume or create it: ${failureTextOf(failure)}`,
          })
        }
        args.log?.(
          `Vercel still has sandbox ${args.name}'s name taken (attempt ${attempt}/${args.retry.attempts}) — waiting for the provider to release it`,
        )
        args.onSettleWait?.({
          reason: ESettleWait.NameConflict,
          attempt,
          attempts: args.retry.attempts,
        })
        await retrySleep(args.retry)
        continue
      }
      throw failure
    }
  }
}
