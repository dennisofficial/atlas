import { CORE_EVENT_TYPES, isBlobRef, type Event, type V2Event } from '@dltech/atlas-core'

type CoreV2Event = Extract<V2Event, Event>

const isCoreEvent = (event: V2Event): event is CoreV2Event => CORE_EVENT_TYPES.has(event.type)

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

/**
 * A plugin's own event, carried untouched: this package cannot name its body, so the surface says
 * which plugin types it parsed and the plugin's own fold narrows them.
 */
const carriedOf = (event: V2Event): Event => withoutChain(event) as unknown as Event

const NO_PLUGIN_TYPES: ReadonlySet<string> = new Set()

const transcriptEventOf = (event: V2Event, pluginTypes: ReadonlySet<string>): Event | null => {
  switch (event.type) {
    case 'history-rewound':
    case 'input-consumed':
    case 'input-refused':
    case 'fact-recorded':
    case 'retry-scheduled':
    case 'branches-observed':
    case 'workspace-prepared':
    case 'workspace-prepare-failed':
    case 'workspace-step':
    case 'session-start-failed':
      return null
    case 'history-summarised':
      return compactedOf(event)
    default:
      if (isCoreEvent(event)) return resolvedOf(withoutChain(event))
      return pluginTypes.has(event.type) ? carriedOf(event) : null
  }
}

export const transcriptEventsOf = (
  events: readonly V2Event[],
  pluginTypes: ReadonlySet<string> = NO_PLUGIN_TYPES,
): Event[] =>
  events.flatMap((event) => {
    const mapped = transcriptEventOf(event, pluginTypes)
    return mapped === null ? [] : [mapped]
  })
