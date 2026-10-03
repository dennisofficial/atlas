import type { Sandbox } from '@vercel/sandbox'

import type { DriveSdk } from './drive-lifecycle'
import { DRIVE_HOME_PATH, DRIVE_MOUNT_PATH } from './drive-names'
import { retrySleep, type RetryPolicy } from './retry-policy'
import {
  SANDBOX_LAUNCH_TIMEOUT_MS,
  SANDBOX_REGION,
  SANDBOX_SERVE_PORT,
  SANDBOX_TIMEOUT_MS,
  WORKSPACE_PATH,
  type VercelCredentials,
  type VercelSdk,
} from './vercel-driver-sdk'
import {
  EVercelFailure,
  failureTextOf,
  isDriveAttachedConflict,
  isImageOptimizeFailure,
  isImageOptimizeLag,
  isSandboxMissing,
  VercelFailure,
} from './vercel-errors'

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
  drive: Awaited<ReturnType<DriveSdk['getOrCreate']>>
  driveName: string
  threadId: string
  token: string
  environment?: Record<string, string> | undefined
  pinnedModel?: string | undefined
  onCreate: () => Promise<void>
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
        mounts: { [DRIVE_MOUNT_PATH]: args.drive },
        onCreate: args.onCreate,
        env: {
          ATLAS_SERVE_TOKEN: args.token,
          ATLAS_SERVE_PORT: String(SANDBOX_SERVE_PORT),
          ATLAS_THREAD_ID: args.threadId,
          ATLAS_CLOUD_URL: args.cloudUrl,
          ATLAS_WORKSPACE_DIR: WORKSPACE_PATH,
          ATLAS_HOME: DRIVE_HOME_PATH,
          VERCEL_TOKEN: args.credentials.token,
          VERCEL_TEAM_ID: args.credentials.teamId,
          VERCEL_PROJECT_ID: args.credentials.projectId,
          ...(args.pinnedModel === undefined ? {} : { ATLAS_MODEL: args.pinnedModel }),
          ...args.environment,
        },
        signal: AbortSignal.timeout(SANDBOX_LAUNCH_TIMEOUT_MS),
      })
    } catch (failure) {
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
      // The probe can delete a stale sandbox and the wake's mount land while Vercel still reports
      // the name gone; the retry budget rides out that settle exactly like the drive detach lag.
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
      if (!isDriveAttachedConflict(failure)) throw failure
      const retry = args.retry
      if (attempt >= retry.attempts) {
        throw new VercelFailure({
          kind: EVercelFailure.DriveAttached,
          message: `drive ${args.driveName} is still attached after ${retry.attempts} attempts to mount it on sandbox ${args.name}: ${failureTextOf(failure)}`,
        })
      }
      args.log?.(
        `drive ${args.driveName} still attached to another sandbox (attempt ${attempt}/${retry.attempts}) — waiting out the detach`,
      )
      await retrySleep(retry)
    }
  }
}
