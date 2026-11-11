import { describe, expect, it } from 'bun:test'

import { EMessageOrigin, toRunId, toThreadId, type InboxEntry } from '@dltech/atlas-core'
import { composeCommands } from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'

import { InboxIntake } from '../inbox-intake'
import type { SessionRecord } from '../record/record-adapter'

const NOW = Date.parse('2026-11-08T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

const entry = (inboxId: number): InboxEntry => ({
  sessionId: 'session-1',
  inboxId,
  kind: 'message',
  payload: JSON.stringify({ text: `m${inboxId}` }),
  postedAt: new Date(NOW).toISOString(),
  consumedSeq: null,
  senderSessionId: null,
})

const intakeOver = (
  readInbox: (args: { afterId: number }) => Promise<InboxEntry[]>,
  record: SessionRecord = {} as SessionRecord,
) =>
  new InboxIntake({
    plane: { readInbox } as unknown as ControlPlane,
    sessionId: 'session-1',
    record,
    threadId: toThreadId('thread-1'),
    runId: () => toRunId('run-1'),
  })

describe('InboxIntake retry entries', () => {
  it('consumes a retry as discarded, drafts nothing and does not wake a turn', async () => {
    const appended: unknown[] = []
    const warnings: string[] = []
    const record = {
      append: async (args: unknown) => appended.push(args),
    } as unknown as SessionRecord
    const intake = new InboxIntake({
      plane: {
        readInbox: async () => [{ ...entry(3), kind: 'retry', payload: '{}' }],
      } as unknown as ControlPlane,
      sessionId: 'session-1',
      record,
      threadId: toThreadId('thread-1'),
      runId: () => toRunId('run-1'),
      log: { warn: (line: { message: string }) => warnings.push(line.message) } as never,
    })
    const drain = await intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(appended).toMatchObject([
      { drafts: [{ type: 'input-consumed', inboxId: 3, consumed: 'discarded' }] },
    ])
    expect(warnings).toEqual([])
  })

  it('still drafts the message that arrived alongside the retry', async () => {
    const record = { append: async () => [] } as unknown as SessionRecord
    const drain = await intakeOver(
      async () => [{ ...entry(1), kind: 'retry', payload: '{}' }, entry(2)],
      record,
    ).prepare()
    expect(drain.drafts).toHaveLength(1)
    expect(drain.wakesTurn).toBe(true)
  })
})

describe('InboxIntake', () => {
  it('rejects when the inbox read fails instead of draining nothing', async () => {
    const intake = intakeOver(async () => {
      throw new Error('inbox read blew up')
    })
    await expect(intake.prepare()).rejects.toThrow('inbox read blew up')
  })

  it('drains the message on the retry after a failed read', async () => {
    let calls = 0
    const intake = intakeOver(async () => {
      calls += 1
      if (calls === 1) throw new Error('blip')
      return [entry(1)]
    })
    await expect(intake.prepare()).rejects.toThrow('blip')
    const drain = await intake.prepare()
    expect(drain.wakesTurn).toBe(true)
    expect(drain.drafts).toHaveLength(1)
  })

  it('tags each drafted message with its inbox id', async () => {
    const drain = await intakeOver(async () => [entry(4)]).prepare()
    expect(drain.drafts).toEqual([
      { type: 'user-said', text: 'm4', requestId: 'inbox:4', inboxId: 4 },
    ])
  })

  it('offers an entry again on the next prepare when its append never consumed it', async () => {
    const afterIds: number[] = []
    const intake = intakeOver(async ({ afterId }) => {
      afterIds.push(afterId)
      return [entry(1), entry(2)]
    })
    const first = await intake.prepare()
    const second = await intake.prepare()
    expect(afterIds).toEqual([0, 0])
    expect(second.drafts).toEqual(first.drafts)
    expect(second.drafts).toHaveLength(2)
  })

  it('drafts a message that carries stored images with its media', async () => {
    const media = [
      {
        media: {
          hash: 'a'.repeat(64),
          mediaType: 'image/png' as const,
          size: 10,
          width: 2,
          height: 3,
        },
        source: 'shot.png',
      },
    ]
    const withMedia = {
      ...entry(5),
      payload: JSON.stringify({ text: '', media }),
    } as InboxEntry
    const drain = await intakeOver(async () => [withMedia]).prepare()
    expect(drain.wakesTurn).toBe(true)
    expect(drain.drafts).toEqual([
      {
        type: 'user-said',
        text: '',
        attachments: [
          {
            id: `media:0:${'a'.repeat(64)}`,
            name: 'shot.png',
            mediaType: 'image/png',
            size: 10,
            source: 'shot.png',
            content: { store: 'media', hash: 'a'.repeat(64) },
            image: { width: 2, height: 3 },
          },
        ],
        requestId: 'inbox:5',
        inboxId: 5,
      },
    ])
  })

  it('drafts an entry carrying a sender session id as a peer agent', async () => {
    const fromSession = { ...entry(9), senderSessionId: 'ses_2' }
    const drain = await intakeOver(async () => [fromSession]).prepare()
    expect(drain.drafts).toEqual([
      {
        type: 'user-said',
        text: 'm9',
        sender: { session: 'ses_2' },
        via: EMessageOrigin.PeerAgent,
        requestId: 'inbox:9',
        inboxId: 9,
      },
    ])
  })

  it('drafts an entry carrying an origin in its payload as that origin', async () => {
    const fromChild = { ...entry(11), payload: JSON.stringify({ text: 'm11', via: 'child-agent' }) }
    const drain = await intakeOver(async () => [fromChild]).prepare()
    expect(drain.drafts).toEqual([
      {
        type: 'user-said',
        text: 'm11',
        via: EMessageOrigin.ChildAgent,
        requestId: 'inbox:11',
        inboxId: 11,
      },
    ])
  })

  it('leaves the draft unchanged when no sender session id rides on the entry', async () => {
    const drain = await intakeOver(async () => [entry(10)]).prepare()
    expect(drain.drafts).toEqual([
      { type: 'user-said', text: 'm10', requestId: 'inbox:10', inboxId: 10 },
    ])
  })

  it('drops a message whose payload carries the sender inside it', async () => {
    const misplaced = {
      ...entry(11),
      payload: JSON.stringify({ text: 'a steer', sender: { session: 'ses_2' } }),
    }
    const drain = await intakeOver(async () => [misplaced], {
      append: async () => [],
    } as unknown as SessionRecord).prepare()
    expect(drain.drafts).toEqual([])
    expect(drain.wakesTurn).toBe(false)
  })

  it('drafts a message that carries uploads', async () => {
    const uploads = [
      {
        uploadId: '11111111-1111-4111-8111-111111111111',
        pathname: 'composer-uploads/user-a/11111111-1111-4111-8111-111111111111/notes.txt',
        name: 'notes.txt',
        size: 7,
        mediaType: 'text/plain',
      },
    ]
    const withUploads = {
      ...entry(6),
      payload: JSON.stringify({ text: 'see file', uploads }),
    } as InboxEntry
    const drain = await intakeOver(async () => [withUploads]).prepare()
    expect(drain.wakesTurn).toBe(true)
    expect(drain.drafts).toEqual([
      {
        type: 'user-said',
        text: 'see file',
        attachments: [
          {
            id: uploads[0]!.uploadId,
            name: 'notes.txt',
            mediaType: 'text/plain',
            size: 7,
            content: {
              store: 'upload',
              uploadId: uploads[0]!.uploadId,
              pathname: uploads[0]!.pathname,
            },
          },
        ],
        requestId: 'inbox:6',
        inboxId: 6,
      },
    ])
  })
})

describe('InboxIntake unresolvable commands', () => {
  const ghost = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
    ...entry(7),
    kind: 'command:ghost',
    payload: '{}',
    ...overrides,
  })

  const run = async (params: { entry: InboxEntry; commands: boolean; now?: number }) => {
    const appended: unknown[] = []
    const warnings: string[] = []
    const infos: string[] = []
    const intake = new InboxIntake({
      plane: { readInbox: async () => [params.entry] } as unknown as ControlPlane,
      sessionId: 'session-1',
      record: { append: async (args: unknown) => appended.push(args) } as unknown as SessionRecord,
      threadId: toThreadId('thread-1'),
      runId: () => toRunId('run-1'),
      ...(params.commands ? { commands: composeCommands([]) } : {}),
      now: () => params.now ?? NOW,
      log: {
        warn: (line: { message: string }) => warnings.push(line.message),
        info: (line: { message: string }) => infos.push(line.message),
      } as never,
    })
    const drain = await intake.prepare()
    return { drain, appended, warnings, infos }
  }

  for (const commands of [true, false]) {
    const label = commands ? 'a registry without the kind' : 'no registry'

    it(`leaves a young command in the inbox with ${label}`, async () => {
      const { drain, appended, warnings, infos } = await run({ entry: ghost(), commands })
      expect(drain).toEqual({ drafts: [], wakesTurn: false })
      expect(appended).toEqual([])
      expect(warnings).toEqual([])
      expect(infos).toHaveLength(1)
    })

    it(`discards a command older than an hour with ${label}`, async () => {
      const { drain, appended, warnings } = await run({
        entry: ghost({ postedAt: new Date(NOW - 2 * HOUR_MS).toISOString() }),
        commands,
      })
      expect(drain).toEqual({ drafts: [], wakesTurn: false })
      expect(appended).toMatchObject([
        { drafts: [{ type: 'input-consumed', inboxId: 7, consumed: 'discarded' }] },
      ])
      expect(warnings).toHaveLength(1)
    })
  }

  it('keeps a command exactly at the age bound and discards it just past', async () => {
    const at = (age: number) => ghost({ postedAt: new Date(NOW - age).toISOString() })
    expect((await run({ entry: at(HOUR_MS), commands: true })).appended).toEqual([])
    expect((await run({ entry: at(HOUR_MS + 1), commands: true })).appended).toHaveLength(1)
  })

  it('discards a command whose postedAt does not parse', async () => {
    const { appended } = await run({ entry: ghost({ postedAt: 'not a date' }), commands: true })
    expect(appended).toHaveLength(1)
  })

  it('still drafts a message that sits behind more than one page of left commands', async () => {
    const left = Array.from({ length: 101 }, (_, index) => ghost({ inboxId: index + 1 }))
    const all = [...left, entry(102)]
    const reads: number[] = []
    const intake = new InboxIntake({
      plane: {
        readInbox: async ({ afterId, limit }: { afterId: number; limit: number }) => {
          reads.push(afterId)
          return all.filter((candidate) => candidate.inboxId > afterId).slice(0, limit)
        },
      } as unknown as ControlPlane,
      sessionId: 'session-1',
      record: { append: async () => [] } as unknown as SessionRecord,
      threadId: toThreadId('thread-1'),
      runId: () => toRunId('run-1'),
      now: () => NOW,
    })
    const drain = await intake.prepare()
    expect(reads).toEqual([0, 100])
    expect(drain.wakesTurn).toBe(true)
    expect(drain.drafts).toEqual([
      { type: 'user-said', text: 'm102', requestId: 'inbox:102', inboxId: 102 },
    ])
  })

  it('stops reading after ten pages', async () => {
    let reads = 0
    const intake = new InboxIntake({
      plane: {
        readInbox: async ({ afterId }: { afterId: number }) => {
          reads += 1
          return Array.from({ length: 100 }, (_, index) => ghost({ inboxId: afterId + index + 1 }))
        },
      } as unknown as ControlPlane,
      sessionId: 'session-1',
      record: {} as SessionRecord,
      threadId: toThreadId('thread-1'),
      runId: () => toRunId('run-1'),
      now: () => NOW,
    })
    await intake.prepare()
    expect(reads).toBe(10)
  })

  it('still consumes a non-command unknown kind as discarded immediately', async () => {
    const { drain, appended, warnings } = await run({
      entry: { ...entry(8), kind: 'mystery', payload: '{}' },
      commands: true,
    })
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(appended).toMatchObject([
      { drafts: [{ type: 'input-consumed', inboxId: 8, consumed: 'discarded' }] },
    ])
    expect(warnings).toHaveLength(1)
  })
})
