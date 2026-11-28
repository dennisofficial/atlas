export enum ESessionPaneTab {
  Details = 'details',
  Changes = 'changes',
  Files = 'files',
  Terminal = 'terminal',
  Browser = 'browser',
}

export const ALL_PANE_TABS: readonly ESessionPaneTab[] = Object.values(ESessionPaneTab)

export const DESKTOP_PANE_TABS: readonly ESessionPaneTab[] = [
  ESessionPaneTab.Changes,
  ESessionPaneTab.Files,
  ESessionPaneTab.Terminal,
  ESessionPaneTab.Browser,
]

const PANE_TABS: readonly string[] = ALL_PANE_TABS

export const PANE_TAB_LABEL: Record<ESessionPaneTab, string> = {
  [ESessionPaneTab.Details]: 'Details',
  [ESessionPaneTab.Changes]: 'Changes',
  [ESessionPaneTab.Files]: 'Files',
  [ESessionPaneTab.Terminal]: 'Terminal',
  [ESessionPaneTab.Browser]: 'Browser',
}

export const desktopPaneTab = (tab: ESessionPaneTab): ESessionPaneTab | undefined =>
  DESKTOP_PANE_TABS.includes(tab) ? tab : undefined

export function isSessionPaneTab(value: unknown): value is ESessionPaneTab {
  return typeof value === 'string' && PANE_TABS.includes(value)
}
