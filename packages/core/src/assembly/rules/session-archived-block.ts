import { systemNotice } from '../../context/envelope'
import type { EventOfType } from '../../events/envelope'

const spawnerOf = (event: EventOfType<'session-archived'>): string =>
  event.byTitle === undefined ? event.bySessionId : `${event.byTitle} (${event.bySessionId})`

export const sessionArchivedBlock = (event: EventOfType<'session-archived'>): string =>
  systemNotice({
    kind: 'session-archived',
    content: [
      `The session ${spawnerOf(event)} that spawned this one archived it.`,
      'If this session is running again, the operator unarchived it.',
    ].join(' '),
  })
