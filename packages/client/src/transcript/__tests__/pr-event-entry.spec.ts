import { describe, expect, it } from 'bun:test'

import { EPrEventKind } from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'

describe('a pr-event entry', () => {
  it('carries the repo and pull request number it belongs to', () => {
    const entries = durableEntries({
      events: log([
        {
          type: 'pr-event',
          repo: 'github.com/owner/repo',
          prNumber: 42,
          kind: EPrEventKind.Comment,
          url: 'https://github.com/owner/repo/pull/42',
        },
      ]),
    })

    expect(entries[0]).toMatchObject({
      kind: EEntryKind.PrEvent,
      repo: 'github.com/owner/repo',
      prNumber: 42,
    })
  })
})
