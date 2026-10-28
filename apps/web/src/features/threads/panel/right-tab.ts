export enum ERightTab {
  Agents = 'agents',
  Subscriptions = 'subscriptions',
  Changes = 'changes',
  Files = 'files',
  Terminal = 'terminal',
  Preview = 'preview',
}

const RIGHT_TABS: string[] = Object.values(ERightTab)

export const TAB_LABEL: Record<ERightTab, string> = {
  [ERightTab.Agents]: 'Agents',
  [ERightTab.Subscriptions]: 'Subscriptions',
  [ERightTab.Changes]: 'Changes',
  [ERightTab.Files]: 'Files',
  [ERightTab.Terminal]: 'Terminal',
  [ERightTab.Preview]: 'Preview',
}

export function isRightTab(value: unknown): value is ERightTab {
  return typeof value === 'string' && RIGHT_TABS.includes(value)
}
