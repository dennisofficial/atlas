import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EShellEndCause,
  EShellStatus,
  INBOX_KIND_RECORD,
  isTurnTaking,
  type InboxEntry,
} from '@dltech/atlas-core'

import { drainRecordEntry, releaseNothingDraft } from '../notice-drain'

const entry = (payload: string): InboxEntry => ({
  sessionId: 'ses_1',
  threadId: null,
  inboxId: 7,
  kind: INBOX_KIND_RECORD,
  payload,
  postedAt: '2026-11-21T10:00:00.000Z',
  consumedSeq: null,
  senderSessionId: null,
})

const quietEnding = JSON.stringify({
  event: {
    type: 'background-shell-ended',
    shellId: 'bash_1',
    command: 'bun test',
    status: EShellStatus.Killed,
    killedBy: EKilledBy.Unrecorded,
    cause: EShellEndCause.SandboxStopped,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
  },
})

describe('draining a record entry', () => {
  it('appends the quiet ending and consumes it in one commit', async () => {
    const committed: unknown[][] = []

    await drainRecordEntry({
      entry: entry(quietEnding),
      appendDrafts: async (drafts) => {
        committed.push([...drafts])
      },
      release: releaseNothingDraft,
    })

    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject([
      { type: 'background-shell-ended', shellId: 'bash_1' },
      { type: 'input-consumed', inboxId: 7 },
    ])
  })

  it('refuses a payload the event gate will not read', async () => {
    const committed: unknown[][] = []

    await drainRecordEntry({
      entry: entry('{"event":{"type":"user-said"}}'),
      appendDrafts: async (drafts) => {
        committed.push([...drafts])
      },
      release: releaseNothingDraft,
    })

    expect(committed[0]).toMatchObject([{ type: 'input-refused', inboxId: 7 }])
  })

  it('carries an ending that never takes the turn', () => {
    const parsed = JSON.parse(quietEnding) as { event: Parameters<typeof isTurnTaking>[0] }

    expect(isTurnTaking(parsed.event)).toBe(false)
  })
})
