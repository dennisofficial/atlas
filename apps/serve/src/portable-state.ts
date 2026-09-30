import { lstat, readFile, rm } from 'node:fs/promises'

import { PORTABLE_STATE_PATH } from '@dltech/atlas-wire'

import { materializePortableState, type PortableStateInstall } from '@dltech/atlas-harness'

export enum EPortableStateBoot {
  Installed = 'installed',
  CleanupFailed = 'cleanup-failed',
  Absent = 'absent',
  Failed = 'failed',
}

export type PortableStateBoot =
  | { kind: EPortableStateBoot.Installed; install: PortableStateInstall }
  | { kind: EPortableStateBoot.CleanupFailed; install: PortableStateInstall; reason: string }
  | { kind: EPortableStateBoot.Absent }
  | { kind: EPortableStateBoot.Failed; reason: string }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'ENOENT'

/**
 * The staging bundle holds sealed credentials, so once it has been read it is removed whether the
 * install holds or not — a bundle that cannot install can never become installable, and recovery
 * is the host re-lifting, not a stale copy lingering on the drive. Reasons name files, never
 * payload contents.
 */
export async function installPortableState(args: {
  path?: string
}): Promise<PortableStateBoot> {
  const path = args.path ?? PORTABLE_STATE_PATH

  let staged
  try {
    staged = await lstat(path)
  } catch (error) {
    if (isMissing(error)) return { kind: EPortableStateBoot.Absent }
    return {
      kind: EPortableStateBoot.Failed,
      reason: `the portable state at ${path} could not be inspected: ${messageOf(error)}`,
    }
  }
  if (!staged.isFile()) {
    return { kind: EPortableStateBoot.Failed, reason: `the portable state at ${path} is not a file` }
  }

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return {
      kind: EPortableStateBoot.Failed,
      reason: `the portable state at ${path} could not be read: ${messageOf(error)}`,
    }
  }

  let stagingError: string | undefined
  try {
    await rm(path)
  } catch (error) {
    stagingError = messageOf(error)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      kind: EPortableStateBoot.Failed,
      reason: `the portable state at ${path} was not valid JSON; the staging bundle was removed, and the host re-lifts to replace it`,
    }
  }

  let install: PortableStateInstall
  try {
    install = await materializePortableState({ state: parsed })
  } catch (error) {
    return {
      kind: EPortableStateBoot.Failed,
      reason: `the portable state at ${path} did not install (${messageOf(error)}); the staging bundle was removed, and the host re-lifts to replace it`,
    }
  }

  if (stagingError !== undefined) {
    return {
      kind: EPortableStateBoot.CleanupFailed,
      install,
      reason: `the portable state installed, but the staging bundle at ${path} would not delete: ${stagingError}`,
    }
  }
  return { kind: EPortableStateBoot.Installed, install }
}
