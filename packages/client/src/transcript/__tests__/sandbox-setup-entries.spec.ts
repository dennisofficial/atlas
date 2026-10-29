import { describe, expect, it } from 'bun:test'

import { durableEntries } from '../durable-entries'
import { EAuthor, EEntryKind } from '../transcript-model'
import { log } from './fixture'

describe('a sandbox-setup-reported event', () => {
  it('maps a failure to a failed sandbox notice keyed by the event', () => {
    const events = log([
      { type: 'sandbox-setup-reported', text: 'Cloud setup failed: boom', failed: true },
    ])

    expect(durableEntries({ events })).toEqual([
      {
        kind: EEntryKind.SandboxNotice,
        author: EAuthor.Model,
        key: events[0]?.id ?? '',
        text: 'Cloud setup failed: boom',
        failed: true,
      },
    ])
  })

  it('maps a warning to a sandbox notice that is not failed', () => {
    const events = log([
      {
        type: 'sandbox-setup-reported',
        text: 'image: not applied in Cloud sandboxes',
        failed: false,
      },
    ])

    expect(durableEntries({ events })[0]).toMatchObject({
      kind: EEntryKind.SandboxNotice,
      failed: false,
    })
  })
})
