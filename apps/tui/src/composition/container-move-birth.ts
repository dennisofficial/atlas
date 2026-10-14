import { EBirthNode, type ArchiveBuildProgress } from '@dltech/atlas-harness'

import { EStepMark, type ContainerMove, type MoveRow } from './container-move'
import type { OverlayPresence } from './overlay-presence'
import type { KeyEvent } from '@opentui/core'

export const SERVE_STAGE_TEXT = 'starting serve'

const PROVISION_IDLE_LABEL = 'waiting for the sandbox'

const sameBuild = ({ a, b }: { a: ArchiveBuildProgress; b: ArchiveBuildProgress }): boolean =>
  a.phase === b.phase && a.files === b.files && a.bytes === b.bytes && a.totalBytes === b.totalBytes

export function updateMoveBuild(args: {
  move: ContainerMove
  progress: ArchiveBuildProgress
}): ContainerMove {
  const { move, progress } = args
  if (move.failure !== null) return move

  const row = move.rows.find((candidate) => candidate.nodeIds.includes(EBirthNode.CaptureWorkspace))
  if (row === undefined || row.mark !== EStepMark.Active) return move
  if (move.build !== undefined && sameBuild({ a: move.build, b: progress })) return move

  return { ...move, build: progress }
}

export function serveStageOf(row: MoveRow): string | null {
  if (row.mark !== EStepMark.Active || !row.nodeIds.includes(EBirthNode.Provision)) return null
  if (row.text !== PROVISION_IDLE_LABEL) return null

  const transfers = row.transfers ?? []
  if (transfers.length === 0 || !transfers.every((transfer) => transfer.complete)) return null
  return SERVE_STAGE_TEXT
}

export const isCancelKey = (key: KeyEvent): boolean =>
  key.name === 'escape' || (key.ctrl === true && key.name === 'c')

/**
 * A move owns the keyboard only once there is something for a key to do: a failure to dismiss or
 * a birth to cancel. Any other move holds the composer without claiming keys, so the session
 * chords still reach their bindings.
 */
export const moveOverlayPresence = (args: {
  move: ContainerMove | null
  handleKey: (key: KeyEvent) => void
}): OverlayPresence => {
  const { move } = args
  const claimsKeys = move !== null && (move.failure !== null || move.cancellable === true)

  return {
    open: move !== null,
    handleKey: claimsKeys ? args.handleKey : undefined,
    coversComposer: true,
    coversTranscript: true,
  }
}
