import type { IPayloadState } from './state'

export function selectedPayload({
  state,
  isComplete,
}: {
  state: IPayloadState
  isComplete: (hash: string) => boolean
}): string | undefined {
  for (const hash of [state.current, state.previous]) {
    if (hash === undefined || hash === state.failed) continue
    if (isComplete(hash)) return hash
  }
  return undefined
}

export function stalePayloads({ dirs, state }: { dirs: string[]; state: IPayloadState }): string[] {
  const keep = new Set(
    [state.current, state.previous].filter((hash): hash is string => hash !== undefined),
  )
  return dirs.filter((dir) => !keep.has(dir))
}
