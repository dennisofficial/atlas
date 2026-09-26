import { Drive } from '@vercel/sandbox'

import { failureTextOf, isSandboxMissing } from './vercel-errors'

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const stillAttached = (failure: unknown): boolean =>
  failureTextOf(failure).includes('currently attached')

const DELETE_ATTEMPTS = 10
const DELETE_RETRY_DELAY_MS = 2_000

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
}): Promise<void> {
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
        if (!stillAttached(failure) || attempt >= DELETE_ATTEMPTS - 1) throw failure
        await sleep(DELETE_RETRY_DELAY_MS)
      }
    }
  }
}
