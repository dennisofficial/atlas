import type { Event, EventOfType } from '../events/envelope'
import type { ThreadId } from '../events/ids'
import { EWaitEpisodeKind, type WaitEpisodeRef, type WaitingForModel } from './waiting'

export const waitEpisodeGroupKey = (episode: WaitEpisodeRef): string => {
  if (episode.kind === EWaitEpisodeKind.Credential) {
    const { accountId, providerId, modelId } = episode.key
    return JSON.stringify([episode.kind, accountId, providerId, modelId])
  }
  return JSON.stringify([episode.kind, episode.code, episode.providerId, episode.modelId])
}

const generationOf = (episode: WaitEpisodeRef): number =>
  episode.kind === EWaitEpisodeKind.Credential ? episode.generation : 0

const unionThreads = ({
  first,
  second,
}: {
  first: readonly ThreadId[]
  second: readonly ThreadId[]
}): readonly ThreadId[] => [...new Set([...first, ...second])]

const mergeObservation = ({
  current,
  observed,
}: {
  current: WaitingForModel
  observed: WaitingForModel
}): WaitingForModel => {
  const affectedThreadIds = unionThreads({
    first: current.affectedThreadIds,
    second: observed.affectedThreadIds,
  })
  const superseded = generationOf(observed.episode) < generationOf(current.episode)
  return superseded ? { ...current, affectedThreadIds } : { ...observed, affectedThreadIds }
}

const isClearedBy = ({
  current,
  cleared,
}: {
  current: WaitingForModel
  cleared: WaitEpisodeRef
}): boolean => generationOf(cleared) >= generationOf(current.episode)

export const projectWaiting = (events: readonly Event[]): readonly WaitingForModel[] => {
  const unresolved = new Map<string, WaitingForModel>()
  for (const event of events) {
    if (event.type === 'model-waiting') {
      applyWaiting({ unresolved, event })
      continue
    }
    if (event.type === 'model-wait-cleared') applyCleared({ unresolved, event })
  }
  return [...unresolved.values()]
}

const applyWaiting = ({
  unresolved,
  event,
}: {
  unresolved: Map<string, WaitingForModel>
  event: EventOfType<'model-waiting'>
}): void => {
  const key = waitEpisodeGroupKey(event.waiting.episode)
  const current = unresolved.get(key)
  unresolved.set(
    key,
    current === undefined ? event.waiting : mergeObservation({ current, observed: event.waiting }),
  )
}

const applyCleared = ({
  unresolved,
  event,
}: {
  unresolved: Map<string, WaitingForModel>
  event: EventOfType<'model-wait-cleared'>
}): void => {
  const key = waitEpisodeGroupKey(event.episode)
  const current = unresolved.get(key)
  if (current === undefined) return
  if (isClearedBy({ current, cleared: event.episode })) unresolved.delete(key)
}
