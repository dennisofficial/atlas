import type { ControlPlane } from '@dltech/atlas-control'
import {
  sessionExcerptOf,
  type Event,
  type RecordEvent,
  type RecordEventType,
} from '@dltech/atlas-core'
import type { SessionNameSuggester } from '@dltech/atlas-native-commands'

import type { SessionNamer } from './session-namer'

export const RENAME_TITLING_TIMEOUT_MS = 20_000
export const RECENT_SEQ_WINDOW = 2_000

const PAGE_LIMIT = 1_000
const MAX_PAGES = 4
const PROSE_TYPES: readonly RecordEventType[] = ['user-said', 'assistant-said']

export type ExcerptPlane = Pick<ControlPlane, 'readSession' | 'head' | 'readEvents'>

const proseOf = (events: readonly RecordEvent[]): Event[] =>
  events.flatMap((event) =>
    event.type === 'user-said' || event.type === 'assistant-said' ? [event] : [],
  )

const recentProseOf = async (args: {
  plane: ExcerptPlane
  threadId: string
  afterSeq: number
}): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
  let cursor = args.afterSeq
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const read = await args.plane.readEvents({
      threadId: args.threadId,
      afterSeq: cursor,
      limit: PAGE_LIMIT,
      visible: true,
      onlyTypes: PROSE_TYPES,
    })
    events.push(...read.events)
    if (read.next === undefined) break
    cursor = read.next
  }
  return events
}

export const sessionProseOf = async (args: {
  plane: ExcerptPlane
  threadId: string
}): Promise<Event[]> => {
  const { plane, threadId } = args
  const head = await plane.head({ threadId })
  const opening = await plane.readEvents({
    threadId,
    afterSeq: 0,
    limit: 1,
    visible: false,
    onlyTypes: ['user-said'],
  })
  const recent = await recentProseOf({
    plane,
    threadId,
    afterSeq: Math.max(0, head.seq - RECENT_SEQ_WINDOW),
  })
  const first = opening.events[0]
  const openingIsRecent = first === undefined || recent.some((event) => event.seq === first.seq)
  return proseOf(openingIsRecent ? recent : [first, ...recent])
}

export const sessionNameSuggesterOf =
  (deps: {
    plane: ExcerptPlane
    namer: SessionNamer
    onFault?: ((fault: unknown) => void) | undefined
  }): SessionNameSuggester =>
  async ({ sessionId }) => {
    const session = await deps.plane.readSession({ sessionId })
    if (session === undefined) return null
    const events = await sessionProseOf({ plane: deps.plane, threadId: session.mainThreadId })
    const text = sessionExcerptOf({ events })
    if (text === '') return null
    return deps.namer({
      userId: session.userId,
      projectId: session.projectId,
      text,
      modelRef: session.modelRef,
      signal: AbortSignal.timeout(RENAME_TITLING_TIMEOUT_MS),
      onFault: deps.onFault,
    })
  }
