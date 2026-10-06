import { deleteDrive, detachThenDeleteDrive, waitForDriveDetached, type DriveSdk } from './drive-lifecycle'
import { driveNameFor } from './drive-names'
import type { RetryPolicy } from './retry-policy'
import type { VercelCredentials } from './vercel-driver-sdk'

export async function deleteThreadDrive(args: {
  sdk: DriveSdk
  credentials: VercelCredentials
  retry: RetryPolicy
  log: ((line: string) => void) | undefined
  threadId: string
  sandboxName: string
  fenced: boolean
}): Promise<void> {
  const driveName = driveNameFor({ threadId: args.threadId })
  const drive = { sdk: args.sdk, credentials: args.credentials, name: driveName, retry: args.retry }
  if (args.fenced) {
    if (!(await waitForDriveDetached(drive))) {
      throw new Error(
        `drive ${driveName} still reads attached after sandbox ${args.sandboxName} was deleted; it is kept because a replacement session may hold it`,
      )
    }
    await deleteDrive(drive)
    return
  }
  if (await detachThenDeleteDrive(drive)) return
  args.log?.(
    `drive ${driveName} still read attached when its delete ran — the delete's retry waited out the detach`,
  )
}
