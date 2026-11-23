import type { ContextFileRow, ContextFileWrite } from '../../context-files'
import type { State } from './memory-state'

const contextFileKey = (params: { sessionId: string; path: string }): string =>
  `${params.sessionId}\u0000${params.path}`

export const upsertContextFilesIn = (params: {
  state: State
  sessionId: string
  files: readonly ContextFileWrite[]
  at: number
}): void => {
  for (const file of params.files) {
    const key = contextFileKey({ sessionId: params.sessionId, path: file.path })
    params.state.contextFiles.set(key, { ...file, updatedAt: params.at })
  }
}

export const removeContextFilesIn = (params: {
  state: State
  sessionId: string
  paths: readonly string[]
}): void => {
  for (const path of params.paths) {
    params.state.contextFiles.delete(contextFileKey({ sessionId: params.sessionId, path }))
  }
}

export const listContextFilesIn = (params: { state: State; sessionId: string }): ContextFileRow[] =>
  [...params.state.contextFiles.entries()]
    .filter(([key]) => key.startsWith(`${params.sessionId}\u0000`))
    .map(([, row]) => ({ ...row }))
    .sort((left, right) => left.path.localeCompare(right.path))

export const contextFileIn = (params: {
  state: State
  sessionId: string
  path: string
}): ContextFileRow | null => {
  const row = params.state.contextFiles.get(contextFileKey(params))
  return row === undefined ? null : { ...row }
}

export const contextDigestsReferencedIn = (params: {
  state: State
  digests: readonly string[]
}): ReadonlySet<string> => {
  const wanted = new Set(params.digests)
  const found = new Set<string>()
  for (const row of params.state.contextFiles.values()) {
    if (row.digest !== null && wanted.has(row.digest)) found.add(row.digest)
  }
  return found
}
