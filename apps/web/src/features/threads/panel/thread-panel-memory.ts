import type { ERightTab } from './right-tab'

export type ThreadPanelMemory = {
  tab?: ERightTab
  openFolders?: string[]
}

const memoryByThread = new Map<string, ThreadPanelMemory>()

export function recallThreadPanel(threadId: string): ThreadPanelMemory {
  return memoryByThread.get(threadId) ?? {}
}

export function rememberThreadPanel(args: { threadId: string; patch: ThreadPanelMemory }): void {
  memoryByThread.set(args.threadId, { ...recallThreadPanel(args.threadId), ...args.patch })
}
