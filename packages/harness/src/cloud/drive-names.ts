import { createHash } from 'node:crypto'

const DRIVE_NAME_PREFIX = 'atlas-drive'
const DIGEST_LENGTH = 24

const digestOf = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, DIGEST_LENGTH)

/**
 * Derived the same way as the sandbox name (sandbox-names.ts): the drive and the sandbox are
 * provisioned from different places — the claim row records the name, the driver derives it — so
 * both sides must agree without asking each other.
 */
export function driveNameFor(args: { threadId: string }): string {
  return `${DRIVE_NAME_PREFIX}-${digestOf(args.threadId)}`
}

/**
 * The drive mounts at the sandbox root; the workspace and the serve's atlas home are directories
 * beneath it. Both live on the drive so a sandbox recreation — drift, expiry, a stopped session —
 * loses nothing: the project checkout and the transcript survive on the drive.
 */
export const DRIVE_MOUNT_PATH = '/atlas'
export const DRIVE_WORKSPACE_PATH = `${DRIVE_MOUNT_PATH}/workspace`
export const DRIVE_HOME_PATH = `${DRIVE_MOUNT_PATH}/home`

/** Small per-thread drives; the SDK's default is 1 TiB. */
export const DRIVE_MAX_BYTES = 50 * 1024 ** 3
