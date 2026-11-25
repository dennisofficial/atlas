import { describe, expect, it } from 'bun:test'

import type { InboxEntry, SpawnFile } from '@dltech/atlas-core'

import { seedContextFiles } from '../context-seed'
import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'

const SESSION = 'session-seed'
const AT = '2026-11-25T00:00:00.000Z'
const INBOX_ID = 7
const FILES: readonly SpawnFile[] = [{ path: 'plan.md', text: 'the plan' }]

const entryOf = (): InboxEntry => ({
  sessionId: SESSION,
  inboxId: INBOX_ID,
  kind: 'message',
  threadId: null,
  senderSessionId: null,
  postedAt: AT,
  consumedSeq: null,
  payload: JSON.stringify({ text: 'read the plan', files: FILES }),
})

const seedWith = async (
  entries: readonly InboxEntry[] | undefined,
): Promise<{ placed: (readonly SpawnFile[])[]; reads: number[] }> => {
  const placed: (readonly SpawnFile[])[] = []
  const reads: number[] = []
  const deps = {
    sessionId: SESSION,
    plane: {
      readInboxEntry: async (params: { inboxId: number }) => {
        reads.push(params.inboxId)
        return entryOf()
      },
    },
  } as unknown as HeldSessionDeps
  const runtime = {
    placeContextFiles: async (params: { files: readonly SpawnFile[] }) => {
      placed.push(params.files)
      return { written: params.files.length, refused: [] }
    },
  } as unknown as SessionRuntime
  const record = {
    eventCache: () => ({
      eventsAfter: () => [{ type: 'input-posted', inboxId: INBOX_ID, kind: 'message' }],
    }),
  } as unknown as SessionRecord
  await seedContextFiles({
    deps,
    runtime,
    record,
    ...(entries === undefined ? {} : { entries }),
  })
  return { placed, reads }
}

describe('seeding the first message context files', () => {
  it('places them from the entries decide already read, without a second inbox read', async () => {
    const { placed, reads } = await seedWith([entryOf()])

    expect(placed).toEqual([FILES])
    expect(reads).toEqual([])
  })

  it('reads the entry when the snapshot does not carry it', async () => {
    const { placed, reads } = await seedWith([{ ...entryOf(), inboxId: INBOX_ID + 1 }])

    expect(placed).toEqual([FILES])
    expect(reads).toEqual([INBOX_ID])
  })

  it('reads the entry when the caller has no snapshot', async () => {
    const { placed, reads } = await seedWith(undefined)

    expect(placed).toEqual([FILES])
    expect(reads).toEqual([INBOX_ID])
  })
})
