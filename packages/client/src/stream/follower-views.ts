import { EWorkspaceStep, EWorkspaceStepState, type PluginViewFold } from '@dltech/atlas-core'

import type { FollowedState } from './follower-state'
import type { SessionWindow } from './session-window'

export const settlesSetup = (events: readonly Record<string, unknown>[]): boolean =>
  events.some(
    (event) =>
      event.type === 'workspace-step' &&
      event.step === EWorkspaceStep.Setup &&
      event.state !== EWorkspaceStepState.Started,
  )

export const acceptsView = (args: { inner: FollowedState; at: number }): boolean =>
  args.at >= (args.inner.window.cursor?.seq ?? 0)

export const viewSettlesCatchUp = (args: { inner: FollowedState; at: number }): boolean =>
  args.inner.window.cursor !== undefined && args.at <= args.inner.window.cursor.seq

export const adoptRewindable = (args: {
  window: SessionWindow
  views: readonly PluginViewFold[]
  pluginViews: Readonly<Record<string, unknown>>
}): SessionWindow => {
  const owned = args.views.filter(
    (view) => view.rewindable === true && Object.hasOwn(args.pluginViews, view.name),
  )
  const changed = owned.some(
    (view) => args.window.view.pluginViews[view.name] !== args.pluginViews[view.name],
  )
  if (!changed) return args.window
  const pluginViews = { ...args.window.view.pluginViews }
  for (const view of owned) {
    if (Object.hasOwn(args.pluginViews, view.name))
      pluginViews[view.name] = args.pluginViews[view.name]
  }
  return { ...args.window, view: { ...args.window.view, pluginViews } }
}
