import { describe, expect, it } from 'bun:test'

import type { ToolRun, TranscriptEntry } from '@dltech/atlas-client/transcript'
import { EAuthor, EEntryKind } from '@dltech/atlas-client/transcript'

import { EMessageAuthor, ENoticeTone, ERowKind, rowsOf } from '../rows'

const said = (key: string, text: string): TranscriptEntry => ({
  kind: EEntryKind.OperatorSaid,
  author: EAuthor.Operator,
  key,
  text,
  said: [text],
  steer: false,
  skills: [],
  files: [],
  attachments: [],
})

const reply = (key: string, text: string, streaming = false): TranscriptEntry => ({
  kind: EEntryKind.ModelSaid,
  author: EAuthor.Model,
  key,
  text,
  streaming,
  interrupted: false,
  muted: false,
})

const thought = (key: string, text: string, streaming = false): TranscriptEntry => ({
  kind: EEntryKind.ModelThought,
  author: EAuthor.Model,
  key,
  text,
  streaming,
  heldOpen: false,
  interrupted: false,
})

const run = (key: string): ToolRun => ({
  key,
  openedBy: 'call_1' as ToolRun['openedBy'],
  calls: [
    {
      callId: 'call_1' as ToolRun['calls'][number]['callId'],
      name: 'read',
      input: { path: 'a.ts' },
      output: 'ok',
      modelText: '',
      state: 'ok' as ToolRun['calls'][number]['state'],
      note: null,
      at: '2026-11-08T20:00:00.000Z',
      settledAt: '2026-11-08T20:00:02.000Z',
      attachments: [],
    },
  ],
})

const tools = (key: string, toolRun: ToolRun, streaming = false): TranscriptEntry => ({
  kind: EEntryKind.ToolsRan,
  author: EAuthor.Model,
  key,
  text: 'Read a.ts',
  streaming,
  interrupted: false,
  run: toolRun,
})

const turnEnded = (key: string, durationMs: number): TranscriptEntry => ({
  kind: EEntryKind.TurnEnded,
  author: EAuthor.Model,
  key,
  text: '',
  durationMs,
  outputTokens: 12,
  endedAt: '2026-11-08T20:00:09.000Z',
  interrupted: false,
})

const rowsNow = (entries: TranscriptEntry[], working = false) =>
  rowsOf({ entries, working, now: Date.parse('2026-11-08T20:00:10.000Z') })

describe('rowsOf', () => {
  it('keeps a user message and the reply in order', () => {
    const rows = rowsNow([said('u1', 'hello'), reply('m1', 'hi there')])
    expect(rows.map((row) => row.kind)).toEqual([ERowKind.Message, ERowKind.Message])
    expect(rows[0]).toMatchObject({ author: EMessageAuthor.You, text: 'hello' })
    expect(rows[1]).toMatchObject({ author: EMessageAuthor.Atlas, text: 'hi there' })
  })

  it('drops a muted or empty reply', () => {
    const muted: TranscriptEntry = {
      kind: EEntryKind.ModelSaid,
      author: EAuthor.Model,
      key: 'm1',
      text: '   ',
      streaming: false,
      interrupted: false,
      muted: true,
    }
    const rows = rowsNow([said('u1', 'hello'), muted, reply('m2', 'answer')])
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ text: 'answer' })
  })

  it('folds thoughts and tool runs into one work row and reads its duration', () => {
    const rows = rowsNow([
      said('u1', 'read the file'),
      thought('t1', 'I should read a.ts'),
      tools('r1', run('run-1')),
      turnEnded('end', 9000),
      reply('m1', 'done'),
    ])
    expect(rows.map((row) => row.kind)).toEqual([ERowKind.Message, ERowKind.Work, ERowKind.Message])
    const work = rows[1]
    expect(work?.kind).toBe(ERowKind.Work)
    if (work?.kind !== ERowKind.Work) return
    expect(work.items).toHaveLength(2)
    expect(work.stepCount).toBe(2)
    expect(work.elapsed).toBe('9s')
    expect(work.running).toBe(false)
  })

  it('shows a work row as running while its call is unsettled', () => {
    const rows = rowsNow([said('u1', 'go'), tools('r1', run('run-1'), true)], true)
    const work = rows[1]
    expect(work?.kind).toBe(ERowKind.Work)
    if (work?.kind !== ERowKind.Work) return
    expect(work.running).toBe(true)
  })

  it('turns a failed sandbox notice into an attention row with its body', () => {
    const rows = rowsNow([
      {
        kind: EEntryKind.SandboxNotice,
        author: EAuthor.Model,
        key: 'boot',
        text: 'The sandbox failed to boot\n\nno image',
        failed: true,
      },
    ])
    expect(rows[0]).toMatchObject({
      kind: ERowKind.Notice,
      title: 'The sandbox failed to boot',
      body: 'no image',
      tone: ENoticeTone.Attention,
    })
  })

  it('turns a system notice into quiet copy behind a prefix', () => {
    const rows = rowsNow([
      {
        kind: EEntryKind.SystemNotice,
        author: EAuthor.Model,
        key: 'n1',
        text: 'the model changed',
        content: 'opus',
      },
    ])
    expect(rows[0]).toMatchObject({
      title: 'Atlas noticed — the model changed',
      body: 'opus',
      tone: ENoticeTone.Quiet,
    })
  })

  it('keeps attachments on a user message that carried only a file', () => {
    const withFile: TranscriptEntry = {
      kind: EEntryKind.OperatorSaid,
      author: EAuthor.Operator,
      key: 'u1',
      text: '',
      said: [],
      steer: false,
      skills: [],
      files: [],
      attachments: [
        {
          id: 'u',
          name: 'shot.png',
          mediaType: 'image/png',
          size: 10,
          content: { store: 'upload' as const, uploadId: 'up_1', pathname: 'shot.png' },
        },
      ],
    }
    const rows = rowsNow([withFile])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: ERowKind.Message, author: EMessageAuthor.You })
  })

  it('stamps messages and notices with the time the event arrived', () => {
    const entries = [said('u1', 'hello'), reply('m1', 'hi there')]
    const rows = rowsOf({
      entries,
      working: false,
      now: Date.parse('2026-11-08T20:00:10.000Z'),
      atOf: (id) => (id === 'u1' ? '2026-11-08T20:00:00.000Z' : '2026-11-08T20:00:05.000Z'),
    })
    expect(rows.map((row) => row.kind)).toEqual([ERowKind.Message, ERowKind.Message])
    expect(rows.map((row) => (row.kind === ERowKind.Message ? row.at : undefined))).toEqual([
      '2026-11-08T20:00:00.000Z',
      '2026-11-08T20:00:05.000Z',
    ])
  })
})
