import { CORE_EVENT_TYPES, isBlobRef, type Event, type RecordEvent } from '@dltech/atlas-core'

type CoreRecordEvent = Extract<RecordEvent, Event>

const isCoreEvent = (event: RecordEvent): event is CoreRecordEvent =>
  CORE_EVENT_TYPES.has(event.type)

type WithoutChain<TEvent> = TEvent extends unknown ? Omit<TEvent, 'epoch' | 'prevHash'> : never

const withoutChain = <TEvent extends { epoch: number; prevHash: string }>(
  event: TEvent,
): WithoutChain<TEvent> => {
  const { epoch: _epoch, prevHash: _prevHash, ...rest } = event
  return rest as WithoutChain<TEvent>
}

const compactedOf = (event: Extract<RecordEvent, { type: 'history-summarised' }>): Event => ({
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
const carriedOf = (event: RecordEvent): Event => withoutChain(event) as unknown as Event

const NO_PLUGIN_TYPES: ReadonlySet<string> = new Set()

const transcriptEventOf = (event: RecordEvent, pluginTypes: ReadonlySet<string>): Event | null => {
  const type: string = event.type
  switch (event.type) {
    case 'history-rewound':
      return null
    case 'input-consumed':
      return event.command === undefined ? null : carriedOf(event)
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
      return pluginTypes.has(type) ? carriedOf(event) : null
  }
}

export const transcriptEventsOf = (
  events: readonly RecordEvent[],
  pluginTypes: ReadonlySet<string> = NO_PLUGIN_TYPES,
): Event[] =>
  events.flatMap((event) => {
    const mapped = transcriptEventOf(event, pluginTypes)
    return mapped === null ? [] : [mapped]
  })
