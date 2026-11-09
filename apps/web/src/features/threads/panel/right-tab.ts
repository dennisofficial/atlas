export enum ERightTab {
  Details = 'details',
  Changes = 'changes',
  Files = 'files',
  Terminal = 'terminal',
  Preview = 'preview',
}

const RIGHT_TABS: string[] = Object.values(ERightTab)

export const TAB_LABEL: Record<ERightTab, string> = {
  [ERightTab.Details]: 'Details',
  [ERightTab.Changes]: 'Changes',
  [ERightTab.Files]: 'Files',
  [ERightTab.Terminal]: 'Terminal',
  [ERightTab.Preview]: 'Preview',
}

export const BROWSER_LABEL = 'Browser'

export function tabLabel(args: { tab: ERightTab; nativeBrowser: boolean }): string {
  if (args.nativeBrowser && args.tab === ERightTab.Preview) return BROWSER_LABEL
  return TAB_LABEL[args.tab]
}

export function isRightTab(value: unknown): value is ERightTab {
  return typeof value === 'string' && RIGHT_TABS.includes(value)
}
