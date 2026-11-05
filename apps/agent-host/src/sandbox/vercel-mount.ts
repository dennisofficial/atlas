import type { Sandbox } from '@vercel/sandbox'

import {
  retrySleep,
  SANDBOX_HOME_PATH,
  SANDBOX_LAUNCH_TIMEOUT_MS,
  SANDBOX_REGION,
  SANDBOX_SERVE_PORT,
  SANDBOX_SNAPSHOT_RETENTION,
  SANDBOX_TIMEOUT_MS,
  type RetryPolicy,
  type VercelCredentials,
} from './constants'
import {
  failureTextOf,
  isImageNotFound,
  isImageOptimizeFailure,
  isImageOptimizeLag,
  isSandboxMissing,
  isSandboxNameConflict,
  VercelFailure,
} from './vercel-errors'
import type { VercelSdk } from './vercel-sdk'

export async function mountWithRetries(args: {
  sdk: VercelSdk
  cloudUrl: string
  retry: RetryPolicy
  imageOptimize: RetryPolicy
  log?: ((line: string) => void) | undefined
  credentials: VercelCredentials
  name: string
  image: string
  threadId: string
  token: string
  environment?: Record<string, string> | undefined
  onCreate: () => Promise<void>
}): Promise<Sandbox> {
  for (let attempt = 1, optimizeWaits = 0; ; attempt++) {
    try {
      return await args.sdk.getOrCreate({
        ...args.credentials,
        name: args.name,
        ports: [SANDBOX_SERVE_PORT],
        timeout: SANDBOX_TIMEOUT_MS,
        region: SANDBOX_REGION,
        persistent: true,
        keepLastSnapshots: SANDBOX_SNAPSHOT_RETENTION,
        resume: true,
        image: args.image,
        onCreate: args.onCreate,
        env: {
          ATLAS_SERVE_TOKEN: args.token,
          ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
          ATLAS_THREAD_ID: args.threadId,
          ATLAS_CLOUD_URL: args.cloudUrl,
          ATLAS_HOME: SANDBOX_HOME_PATH,
          ...args.environment,
        },
        signal: AbortSignal.timeout(SANDBOX_LAUNCH_TIMEOUT_MS),
      })
    } catch (failure) {
      if (isImageNotFound(failure)) {
        throw new VercelFailure(
          `sandbox image ${args.image} is not published. Update Atlas — a release that cannot find its own image was cut before its image landed. If you override the image in settings, check the name.`,
        )
      }
      if (isImageOptimizeFailure(failure)) {
        throw new VercelFailure(
          `sandbox image ${args.image} failed Vercel's optimization, and Vercel pins that failure to the published digest — waiting cannot fix it. Re-running the release's sandbox-image retag publishes the same tag under a fresh digest.`,
        )
      }
      if (isImageOptimizeLag(failure)) {
        optimizeWaits += 1
        if (optimizeWaits > args.imageOptimize.attempts) {
          throw new VercelFailure(
            `sandbox ${args.name} still waiting on Vercel to optimize image ${args.image} after ${args.imageOptimize.attempts} retries`,
          )
        }
        args.log?.(
          `Vercel is still optimizing image ${args.image} (wait ${optimizeWaits}/${args.imageOptimize.attempts})`,
        )
        await retrySleep(args.imageOptimize)
        continue
      }
      if (isSandboxMissing(failure)) {
        if (attempt >= args.retry.attempts) {
          throw new VercelFailure(
            `sandbox ${args.name} stayed missing through ${args.retry.attempts} attempts to resume or create it: ${failureTextOf(failure)}`,
          )
        }
        args.log?.(
          `Vercel reported sandbox ${args.name} missing mid-wake (attempt ${attempt}/${args.retry.attempts}) — waiting for the provider to settle`,
        )
        await retrySleep(args.retry)
        continue
      }
      if (isSandboxNameConflict(failure)) {
        if (attempt >= args.retry.attempts) {
          throw new VercelFailure(
            `sandbox ${args.name}'s name stayed taken through ${args.retry.attempts} attempts to resume or create it: ${failureTextOf(failure)}`,
          )
        }
        args.log?.(
          `Vercel still has sandbox ${args.name}'s name taken (attempt ${attempt}/${args.retry.attempts}) — waiting for the provider to release it`,
        )
        await retrySleep(args.retry)
        continue
      }
      throw failure
    }
  }
}
