import { existsSync, renameSync } from 'node:fs'

import { EBuildKind, buildInfo } from '../build/info'
import { readStagedVersionMarker } from '../build/self-update'
import { nextBinaryPathFor } from '../build/self-update-asset'
import { execInPlace } from './respawn-exec'
import { releaseStaged } from './update-check'

export function shouldPromoteStaged(args: {
  kind: EBuildKind
  running: string
  staged: string | null
  nextExists: boolean
}): boolean {
  if (args.kind !== EBuildKind.Release) return false
  if (!args.nextExists) return false
  return releaseStaged({ running: args.running, staged: args.staged })
}

export async function promoteStagedUpdate(args: {
  execPath: string
  argv: readonly string[]
}): Promise<void> {
  const build = buildInfo()
  if (build.kind !== EBuildKind.Release) return

  const nextPath = nextBinaryPathFor(args.execPath)
  const staged = await readStagedVersionMarker(args.execPath)
  if (
    !shouldPromoteStaged({
      kind: build.kind,
      running: build.version,
      staged,
      nextExists: existsSync(nextPath),
    })
  ) {
    return
  }

  try {
    renameSync(nextPath, args.execPath)
  } catch {
    return
  }

  execInPlace([args.execPath, ...args.argv])
}
