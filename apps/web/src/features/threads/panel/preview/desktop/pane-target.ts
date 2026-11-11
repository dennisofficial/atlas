export type PaneTarget = { threadId: string; tabId: string }

const PANE_PREFIX = 'pane:'

export const paneTargetIdOf = (target: PaneTarget): string =>
  `${PANE_PREFIX}${target.threadId}:${target.tabId}`

export function paneTargetOf(id: string): PaneTarget | null {
  if (!id.startsWith(PANE_PREFIX)) return null
  const rest = id.slice(PANE_PREFIX.length)
  const at = rest.lastIndexOf(':')
  if (at <= 0 || at === rest.length - 1) return null
  return { threadId: rest.slice(0, at), tabId: rest.slice(at + 1) }
}
