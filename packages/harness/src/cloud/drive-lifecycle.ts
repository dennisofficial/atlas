import { Drive } from '@vercel/sandbox'

import {
  isSandboxMissing,
} from './vercel-errors'

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
 * A drive that cannot be deleted because it is still mounted must first be detached — the caller
 * deletes the sandbox that holds it before asking again. A drive that is already gone is the
 * desired end state, so a missing one is success.
 */
export async function deleteDrive(args: {
  sdk: DriveSdk
  credentials: VercelCredentials
  name: string
}): Promise<void> {
  const listed = await args.sdk.list({
    ...args.credentials,
    namePrefix: args.name,
    signal: AbortSignal.timeout(30_000),
  })
  for await (const drive of listed) {
    if (drive.name !== args.name) continue
    try {
      await drive.delete({ signal: AbortSignal.timeout(30_000) })
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw failure
    }
  }
}
