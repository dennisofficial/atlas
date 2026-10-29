export enum ERightTab {
  Details = 'details',
  Changes = 'changes',
  Files = 'files',
  Terminal = 'terminal',
  Processes = 'processes',
  Preview = 'preview',
}

const RIGHT_TABS: string[] = Object.values(ERightTab)

export const TAB_LABEL: Record<ERightTab, string> = {
  [ERightTab.Details]: 'Details',
  [ERightTab.Changes]: 'Changes',
  [ERightTab.Files]: 'Files',
  [ERightTab.Terminal]: 'Terminal',
  [ERightTab.Processes]: 'Processes',
  [ERightTab.Preview]: 'Preview',
}

export function isRightTab(value: unknown): value is ERightTab {
  return typeof value === 'string' && RIGHT_TABS.includes(value)
}
