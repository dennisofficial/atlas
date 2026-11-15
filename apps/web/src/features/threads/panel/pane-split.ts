import type { PaneLayout } from './pane-layout-memory'

export const TRANSCRIPT_PANE = 'transcript'
export const RIGHT_PANE = 'right-panel'

export const DEFAULT_PANE_LAYOUT: PaneLayout = { [TRANSCRIPT_PANE]: 50, [RIGHT_PANE]: 50 }
export const COLLAPSED_PANE_LAYOUT: PaneLayout = { [TRANSCRIPT_PANE]: 100, [RIGHT_PANE]: 0 }

export type PaneCommit = {
  remember: PaneLayout | undefined
  collapsed: boolean | undefined
}

export function samePaneLayout(a: PaneLayout | undefined, b: PaneLayout): boolean {
  if (a === undefined) return false
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  return keys.every((key) => a[key] === b[key])
}

function usableExpanded(layout: PaneLayout | undefined): PaneLayout | undefined {
  if (layout === undefined) return undefined
  if (Object.keys(layout).length !== 2) return undefined
  if (layout[TRANSCRIPT_PANE] === undefined) return undefined
  const right = layout[RIGHT_PANE]
  if (right === undefined || right <= 0) return undefined
  return layout
}

export function paneCommitOf(args: {
  layout: PaneLayout
  requestedLayout: PaneLayout | undefined
  isUserInteraction: boolean
}): PaneCommit {
  const { layout, requestedLayout, isUserInteraction } = args
  const collapsed = layout[RIGHT_PANE] === 0
  return {
    remember: collapsed ? undefined : (requestedLayout ?? layout),
    collapsed: isUserInteraction ? collapsed : undefined,
  }
}

export function layoutForCollapse(args: {
  current: PaneLayout
  collapsed: boolean
  expanded: PaneLayout | undefined
}): PaneLayout | undefined {
  const { current, collapsed, expanded } = args
  const right = current[RIGHT_PANE]
  if (right === undefined) return undefined
  if ((right === 0) === collapsed) return undefined
  if (collapsed) return COLLAPSED_PANE_LAYOUT
  return usableExpanded(expanded) ?? DEFAULT_PANE_LAYOUT
}
