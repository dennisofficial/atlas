import type { ActiveConversation } from '@dltech/atlas-harness'
import { threadHandle } from '@dltech/atlas-harness'

/**
 * Below 128 so it cannot be mistaken for a death by signal; the atlas-dev wrapper loops on exactly
 * this code and treats anything else as a real exit.
 */
export const RESTART_EXIT_CODE = 75

export function restartResumeHandle(args: { active: ActiveConversation | null }): string | null {
  const active = args.active
  if (active === null || !active.started) return null

  return threadHandle(active)
}
