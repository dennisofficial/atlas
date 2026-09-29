import { Drive } from '@vercel/sandbox'

import { attachLagRetry, retrySleep, type RetryPolicy } from './retry-policy'
import { isDriveAttachedConflict, isSandboxMissing } from './vercel-errors'

import type { VercelCredentials } from './vercel-driver'
import { DRIVE_MAX_BYTES } from './drive-names'
import { SANDBOX_REGION } from './vercel-driver'

/**
 * The static `Drive` surface the lifecycle uses, injectable so a spec never reaches Vercel.
 * Drives outlive every sandbox: a thread's workspace and transcript live on one, so losing the
 * sandbox — drift recreate, the 14-day idle reaper, a crash — loses nothing.
 */
export type DriveSdk = {
  getOrCreate: (
    params: Parameters<typeof Drive.getOrCreate>[0],
  ) => Promise<Drive>
  list: (
    params?: Parameters<typeof Drive.list>[0],
  ) => Promise<AsyncIterable<Drive>>
}

export const liveDriveSdk: DriveSdk = {
  getOrCreate: (params) => Drive.getOrCreate(params),
  list: (params) => Drive.list(params),
}

export async function ensureDrive(args: {
  sdk: DriveSdk
  credentials: VercelCredentials
  name: string
}): Promise<Drive> {
  return args.sdk.getOrCreate({
    ...args.credentials,
    name: args.name,
    region: SANDBOX_REGION,
    maxSize: DRIVE_MAX_BYTES,
    signal: AbortSignal.timeout(60_000),
  })
}

/**
 * A drive is deleted after the sandbox that mounted it is deleted, and Vercel detaches the drive
 * asynchronously — a delete issued the moment the sandbox is gone lands a 409 `currently attached`
 * until the detach settles, so the delete retries through that lag. A drive that is already gone
 * is the desired end state, so a missing one is success.
 */
export async function deleteDrive(args: {
  sdk: DriveSdk
  credentials: VercelCredentials
  name: string
  retry?: RetryPolicy | undefined
}): Promise<void> {
  const retry = args.retry ?? attachLagRetry
  const listed = await args.sdk.list({
    ...args.credentials,
    namePrefix: args.name,
    // The API rejects namePrefix unless the listing is sorted by name.
    sortBy: 'name',
    signal: AbortSignal.timeout(30_000),
  })
  for await (const drive of listed) {
    if (drive.name !== args.name) continue
    for (let attempt = 0; ; attempt++) {
      try {
        await drive.delete({ signal: AbortSignal.timeout(30_000) })
        return
      } catch (failure) {
        if (isSandboxMissing(failure)) return
        if (!isDriveAttachedConflict(failure) || attempt >= retry.attempts - 1) throw failure
        await retrySleep(retry)
      }
    }
  }
}

/**
 * The mount direction of the same lag: `sandbox.delete()` returns before Vercel detaches the
 * drive, so a sandbox recreated with the same mounts right after lands `already attached as
 * read-write`. Polls the drive's attach state until no sandbox holds it. The SDK's `Drive`
 * metadata is a snapshot fixed at construction, so each poll re-lists for a fresh read. True when
 * the drive is free (or gone); false when the lag outlived the polls — the caller's create retry
 * covers the tail beyond that.
 */
export async function waitForDriveDetached(args: {
  sdk: DriveSdk
  credentials: VercelCredentials
  name: string
  retry?: RetryPolicy | undefined
}): Promise<boolean> {
  const retry = args.retry ?? attachLagRetry
  for (let attempt = 0; attempt < retry.attempts; attempt++) {
    const listed = await args.sdk.list({
      ...args.credentials,
      namePrefix: args.name,
      // The API rejects namePrefix unless the listing is sorted by name.
      sortBy: 'name',
      signal: AbortSignal.timeout(30_000),
    })
    let attached = false
    for await (const drive of listed) {
      if (drive.name === args.name && drive.currentSandboxName !== undefined) attached = true
    }
    if (!attached) return true
    if (attempt < retry.attempts - 1) await retrySleep(retry)
  }
  return false
}
