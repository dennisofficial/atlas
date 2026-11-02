export enum ESearchKeyAction {
  Clear = 'clear',
  Move = 'move',
  Open = 'open',
  None = 'none',
}

export type SearchKeyResult =
  | { action: ESearchKeyAction.Move; active: number }
  | { action: ESearchKeyAction.Clear | ESearchKeyAction.Open | ESearchKeyAction.None }

export function searchKeyResult(args: {
  key: string
  active: number
  count: number
}): SearchKeyResult {
  const { key, active, count } = args
  if (key === 'Escape') return { action: ESearchKeyAction.Clear }
  if (count === 0) return { action: ESearchKeyAction.None }
  if (key === 'ArrowDown') return { action: ESearchKeyAction.Move, active: (active + 1) % count }
  if (key === 'ArrowUp')
    return { action: ESearchKeyAction.Move, active: (active - 1 + count) % count }
  if (key === 'Enter') return { action: ESearchKeyAction.Open }
  return { action: ESearchKeyAction.None }
}
