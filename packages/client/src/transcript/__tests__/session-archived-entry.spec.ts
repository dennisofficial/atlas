import { describe, expect, it } from 'bun:test'

import { durableEntries } from '../durable-entries'
import { EAuthor, EEntryKind } from '../transcript-model'
import { log } from './fixture'

describe('a session-archived event', () => {
  it('becomes a quiet notice naming the spawner by title', () => {
    const events = log([{ type: 'session-archived', bySessionId: 'ses_2', byTitle: 'the parser' }])

    expect(durableEntries({ events })).toEqual([
      {
        kind: EEntryKind.SystemNotice,
        author: EAuthor.Model,
        key: events[0]?.id ?? '',
        text: 'Archived by its spawner the parser',
        content: '',
      },
    ])
  })

  it('falls back to the spawner id when it has no title', () => {
    const events = log([{ type: 'session-archived', bySessionId: 'ses_3' }])

    expect(durableEntries({ events })[0]).toMatchObject({
      text: 'Archived by its spawner ses_3',
    })
  })
})
