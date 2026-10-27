import type { WireEvent } from '@dltech/atlas-wire/web'
import type { ToolProps } from '@dltech/atlas-ui/ai/tool'

import { eventsFromWire } from './events-from-wire'
import {
  durableTranscriptOf,
  ETranscriptKind,
  transcriptViewOf,
  type ToolCallItem,
} from './transcript-items'

export function toolPropsOf(call: ToolCallItem): ToolProps {
  return {
    label: call.label,
    kind: call.kind,
    state: call.state,
    ...(call.title === undefined ? {} : { title: call.title }),
    ...(call.output === undefined ? {} : { output: call.output }),
    ...(call.errorText === undefined ? {} : { errorText: call.errorText }),
    ...(call.elapsed === undefined ? {} : { elapsed: call.elapsed }),
  }
}

export function callsOfEvents(events: readonly WireEvent[]): ToolProps[] {
  const view = transcriptViewOf({
    durable: durableTranscriptOf({ events: eventsFromWire(events) }),
    live: [],
  })
  return view.items.flatMap((item) =>
    item.kind === ETranscriptKind.Tools ? item.calls.map(toolPropsOf) : [],
  )
}

export function briefOfEvents(events: readonly WireEvent[]): string | undefined {
  for (const event of eventsFromWire(events)) {
    if (event.type === 'user-said' && event.text.trim().length > 0) return event.text
  }
  return undefined
}
