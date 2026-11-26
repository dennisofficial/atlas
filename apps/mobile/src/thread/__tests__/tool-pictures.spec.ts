import { describe, expect, it } from 'bun:test'

import type { ToolRun, TranscriptEntry } from '@dltech/atlas-client/transcript'
import { EAuthor, EEntryKind } from '@dltech/atlas-client/transcript'

import { ERowKind, rowsOf } from '../rows'
import { pictureBoxOf, picturesIn, TOOL_PICTURE_MAX_HEIGHT } from '../tool-pictures'

type Call = ToolRun['calls'][number]

const callOf = (args: { id: string; output: unknown; image?: Call['image'] }): Call => ({
  callId: args.id as Call['callId'],
  name: 'read',
  input: { path: '/atlas/home/shot.png' },
  output: args.output,
  modelText: '',
  state: 'ok' as Call['state'],
  note: null,
  at: '2026-11-08T20:00:00.000Z',
  settledAt: '2026-11-08T20:00:02.000Z',
  attachments: [],
  image: args.image,
})

const picture: Call['image'] = {
  kind: 'media',
  media: { hash: 'h1', mediaType: 'image/png', size: 10, width: 1600, height: 800 },
}

const pictureCall = callOf({
  id: 'call_pic',
  output: { path: '/atlas/home/shot.png', mediaType: 'image/png' },
  image: picture,
})

const textCall = callOf({ id: 'call_text', output: 'ok' })

const runOf = (key: string, calls: Call[]): ToolRun => ({
  key,
  openedBy: calls[0]?.callId as ToolRun['openedBy'],
  calls,
})

const tools = (key: string, run: ToolRun): TranscriptEntry => ({
  kind: EEntryKind.ToolsRan,
  author: EAuthor.Model,
  key,
  text: 'Read',
  streaming: false,
  interrupted: false,
  run,
})

const reply = (key: string, text: string): TranscriptEntry => ({
  kind: EEntryKind.ModelSaid,
  author: EAuthor.Model,
  key,
  text,
  streaming: false,
  interrupted: false,
  muted: false,
})

const rowsNow = (entries: TranscriptEntry[]) =>
  rowsOf({ entries, working: false, now: Date.parse('2026-11-08T20:00:10.000Z') })

describe('picturesIn', () => {
  it('keeps the media picture of an image read, named by its file', () => {
    expect(picturesIn(runOf('r1', [textCall, pictureCall]))).toEqual([
      { id: 'call_pic#image', hash: 'h1', alt: 'shot.png', width: 1600, height: 800 },
    ])
  })

  it('skips a media part whose output does not describe an image', () => {
    const odd = callOf({ id: 'call_odd', output: 'ok', image: picture })
    expect(picturesIn(runOf('r1', [odd]))).toEqual([])
  })
})

describe('pictureBoxOf', () => {
  it('scales a tall picture down to the height cap and keeps its shape', () => {
    expect(pictureBoxOf({ width: 400, height: 1600 })).toEqual({
      width: (400 * TOOL_PICTURE_MAX_HEIGHT) / 1600,
      aspectRatio: 0.25,
    })
  })

  it('keeps a small picture at its own size', () => {
    expect(pictureBoxOf({ width: 200, height: 100 })).toEqual({ width: 200, aspectRatio: 2 })
  })
})

describe('rowsOf with pictures', () => {
  it('shows a tool picture as its own row between the work and the reply', () => {
    const rows = rowsNow([
      tools('t1', runOf('r1', [pictureCall])),
      tools('t2', runOf('r2', [textCall])),
      reply('m1', 'done'),
    ])
    expect(rows.map((row) => row.kind)).toEqual([
      ERowKind.Work,
      ERowKind.Images,
      ERowKind.Work,
      ERowKind.Message,
    ])
    expect(rows[1]).toMatchObject({ id: 'images:t1', images: [{ hash: 'h1' }] })
  })

  it('adds no picture row for a run without pictures', () => {
    const rows = rowsNow([tools('t1', runOf('r1', [textCall]))])
    expect(rows.map((row) => row.kind)).toEqual([ERowKind.Work])
  })
})
