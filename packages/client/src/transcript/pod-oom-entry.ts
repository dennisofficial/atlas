import { podOomLine, type EventOfType } from '@dltech/atlas-core'

import { EAuthor, EEntryKind, type PodOomEntry } from './transcript-model'

export const podOomEntryOf = (event: EventOfType<'pod-ran-out-of-memory'>): PodOomEntry => ({
  kind: EEntryKind.PodOom,
  author: EAuthor.Model,
  key: event.id,
  text: podOomLine(event),
  scope: event.scope,
  processes: event.processes,
})
