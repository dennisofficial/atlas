import { isBlobRef, type Event, type V2Event } from '@dltech/atlas-core'

type WithoutChain<TEvent> = TEvent extends unknown ? Omit<TEvent, 'epoch' | 'prevHash'> : never

const withoutChain = <TEvent extends { epoch: number; prevHash: string }>(
  event: TEvent,
): WithoutChain<TEvent> => {
  const { epoch: _epoch, prevHash: _prevHash, ...rest } = event
  return rest as WithoutChain<TEvent>
}

const compactedOf = (event: Extract<V2Event, { type: 'history-summarised' }>): Event => ({
  ...withoutChain(event),
  type: 'history-compacted',
  replaced: event.throughSeq - event.fromSeq + 1,
})

const resolvedOf = (event: Event): Event => {
  if (event.type === 'tool-result' && isBlobRef(event.output)) {
    return { ...event, output: event.output.$blob.preview }
  }
  if (event.type === 'tool-called' && isBlobRef(event.input)) {
    const { input: _input, ...rest } = event
    return rest
  }
  return event
}

const transcriptEventOf = (event: V2Event): Event | null => {
  switch (event.type) {
    case 'history-rewound':
    case 'input-consumed':
    case 'fact-recorded':
    case 'branches-observed':
    case 'workspace-prepared':
    case 'workspace-prepare-failed':
    case 'session-start-failed':
      return null
    case 'history-summarised':
      return compactedOf(event)
    default:
      return resolvedOf(withoutChain(event))
  }
}

export const transcriptEventsOf = (events: readonly V2Event[]): Event[] =>
  events.flatMap((event) => {
    const mapped = transcriptEventOf(event)
    return mapped === null ? [] : [mapped]
  })
