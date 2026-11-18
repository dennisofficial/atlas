import { EWorkspaceStep, EWorkspaceStepState } from '@dltech/atlas-core'

import type { FollowedState } from './follower-state'

export const settlesSetup = (events: readonly Record<string, unknown>[]): boolean =>
  events.some(
    (event) =>
      event.type === 'workspace-step' &&
      event.step === EWorkspaceStep.Setup &&
      event.state !== EWorkspaceStepState.Started,
  )

export const acceptsView = (args: { inner: FollowedState; at: number }): boolean =>
  args.at >= (args.inner.window.cursor?.seq ?? 0)
