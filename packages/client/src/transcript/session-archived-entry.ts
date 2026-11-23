import type { EventOfType } from '@dltech/atlas-core'

import { EAuthor, EEntryKind, type SystemNoticeEntry } from './transcript-model'

const spawnerOf = (event: EventOfType<'session-archived'>): string =>
  event.byTitle ?? event.bySessionId

export const sessionArchivedEntryOf = (
  event: EventOfType<'session-archived'>,
): SystemNoticeEntry => ({
  kind: EEntryKind.SystemNotice,
  author: EAuthor.Model,
  key: event.id,
  text: `Archived by its spawner ${spawnerOf(event)}`,
  content: '',
})
