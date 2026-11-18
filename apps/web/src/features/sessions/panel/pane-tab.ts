export enum ESessionPaneTab {
  Details = 'details',
  Changes = 'changes',
  Files = 'files',
  Terminal = 'terminal',
  Browser = 'browser',
}

const PANE_TABS: string[] = Object.values(ESessionPaneTab)

export const PANE_TAB_LABEL: Record<ESessionPaneTab, string> = {
  [ESessionPaneTab.Details]: 'Details',
  [ESessionPaneTab.Changes]: 'Changes',
  [ESessionPaneTab.Files]: 'Files',
  [ESessionPaneTab.Terminal]: 'Terminal',
  [ESessionPaneTab.Browser]: 'Browser',
}

export function isSessionPaneTab(value: unknown): value is ESessionPaneTab {
  return typeof value === 'string' && PANE_TABS.includes(value)
}
