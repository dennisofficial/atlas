import { EKilledBy } from '@dltech/atlas-core'

import { isHeld, isStepping, type ChildState } from './child-state'
import type { ChildSteps } from './child-steps'
import type { AgentRoster } from './roster'

/**
 * An ending announces itself even when teardown caused it: reopening the conversation should say
 * where a child went, exactly as it says where a background shell went.
 */
export async function stopAllChildren({
  roster,
  steps,
}: {
  roster: AgentRoster
  steps: ChildSteps
}): Promise<void> {
  for (const child of roster.states()) {
    if (isHeld(child)) steps.endHeld({ child, killedBy: EKilledBy.SessionEnd })
    if (isStepping(child) && child.killedBy === undefined) child.killedBy = EKilledBy.SessionEnd
    child.abort.abort()
  }
  await steps.whenSettled()
}

export function stopChild({
  child,
  by,
  steps,
}: {
  child: ChildState
  by: EKilledBy
  steps: ChildSteps
}): void {
  if (isHeld(child)) return steps.endHeld({ child, killedBy: by })
  if (!isStepping(child)) return
  child.killedBy = by
  child.abort.abort()
}

/**
 * A relocation freeze, not a stop: the child halts at the loop's seam with its log intact and no
 * killedBy, expecting to be resumed on the far side of the move.
 */
export function pauseChild({ child }: { child: ChildState }): void {
  if (!isStepping(child)) return
  child.pause.pause()
}
