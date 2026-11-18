import type { FollowPlane } from './follow-types'

type ReadEventsParams = Parameters<FollowPlane['readEvents']>[0]

const shareInFlight = <P, R>(args: {
  call: (params: P) => Promise<R>
  keyOf: (params: P) => string
}): ((params: P) => Promise<R>) => {
  const pending = new Map<string, Promise<R>>()
  return (params) => {
    const key = args.keyOf(params)
    const existing = pending.get(key)
    if (existing !== undefined) return existing
    const started = args.call(params)
    pending.set(key, started)
    const forget = (): void => {
      pending.delete(key)
    }
    started.then(forget, forget)
    return started
  }
}

const readKey = (params: ReadEventsParams): string =>
  JSON.stringify([
    params.threadId,
    params.afterSeq,
    params.limit,
    params.visible,
    params.maxBytes,
    params.hiddenTypes,
  ])

export const sharedReads = (plane: FollowPlane): FollowPlane => ({
  readSession: (params) => plane.readSession(params),
  readSessionView: (params) => plane.readSessionView(params),
  listSessionDigests: (params) => plane.listSessionDigests(params),
  head: shareInFlight({ call: (params) => plane.head(params), keyOf: (params) => params.threadId }),
  readEvents: shareInFlight({ call: (params) => plane.readEvents(params), keyOf: readKey }),
})
