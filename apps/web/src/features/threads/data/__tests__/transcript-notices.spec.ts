import { describe, expect, it } from 'bun:test'

import {
  EEntryKind,
  EAuthor,
  type PrEventEntry,
  type TranscriptEntry,
} from '@dltech/atlas-client/transcript'

import { ENoticeTone, ETranscriptKind } from '../transcript-kind'
import { noticeItemOf, prNoticeItemOf } from '../transcript-notices'

const prEntry = (over: Partial<PrEventEntry> & { key: string }): PrEventEntry => ({
  kind: EEntryKind.PrEvent,
  author: EAuthor.Model,
  text: `PR #42: bot commented — ${over.key}`,
  body: `body of ${over.key}`,
  failed: false,
  repo: 'github.com/owner/repo',
  prNumber: 42,
  ...over,
})

describe('noticeItemOf', () => {
  it('maps a failed shell ending with empty output to a failed notice with a note', () => {
    const entry: TranscriptEntry = {
      kind: EEntryKind.BackgroundShellEnded,
      author: EAuthor.Model,
      key: 'evt_1',
      text: 'build exited 1',
      shellId: 'sh_1',
      output: '',
      failed: true,
    }

    expect(noticeItemOf(entry)).toEqual({
      kind: ETranscriptKind.Notice,
      id: 'evt_1',
      title: 'build exited 1',
      body: '',
      emptyNote: 'printed nothing',
      tone: ENoticeTone.Failed,
    })
  })

  it('prefixes a system notice and keeps it quiet', () => {
    const entry: TranscriptEntry = {
      kind: EEntryKind.SystemNotice,
      author: EAuthor.Model,
      key: 'evt_2',
      text: 'nudge',
      content: 'look',
    }

    expect(noticeItemOf(entry)).toMatchObject({
      title: 'Atlas noticed — nudge',
      body: 'look',
      tone: ENoticeTone.Quiet,
    })
  })

  it('keeps a lone pr-event as a single notice', () => {
    const entry = prEntry({
      key: 'evt_1',
      text: 'PR #42: dennis commented — hi',
      body: 'hi',
    })

    expect(noticeItemOf(entry)).toEqual({
      kind: ETranscriptKind.Notice,
      id: 'evt_1',
      title: 'PR #42: dennis commented — hi',
      body: 'hi',
      tone: ENoticeTone.Ok,
    })
    expect(prNoticeItemOf([entry])).toEqual(noticeItemOf(entry))
  })

  it('ignores entries the transcript renders elsewhere', () => {
    const entry: TranscriptEntry = {
      kind: EEntryKind.TurnEnded,
      author: EAuthor.Model,
      key: 'evt_3',
      text: '',
      durationMs: 1,
      outputTokens: 1,
      endedAt: 't',
      interrupted: false,
    }

    expect(noticeItemOf(entry)).toBeNull()
  })
})

describe('prNoticeItemOf', () => {
  it('folds consecutive pr-events into one group keyed by the first entry', () => {
    const entries = [
      prEntry({ key: 'evt_1' }),
      prEntry({ key: 'evt_2' }),
      prEntry({ key: 'evt_3' }),
    ]

    expect(prNoticeItemOf(entries)).toEqual({
      kind: ETranscriptKind.Notice,
      id: 'evt_1',
      title: 'PR #42: 3 updates',
      body: '',
      tone: ENoticeTone.Ok,
      contexts: [
        {
          id: 'evt_1',
          label: 'PR #42: bot commented — evt_1',
          content: 'body of evt_1',
          superseded: false,
        },
        {
          id: 'evt_2',
          label: 'PR #42: bot commented — evt_2',
          content: 'body of evt_2',
          superseded: false,
        },
        {
          id: 'evt_3',
          label: 'PR #42: bot commented — evt_3',
          content: 'body of evt_3',
          superseded: false,
        },
      ],
    })
  })

  it('turns the group failed and counts what needs attention when a member failed', () => {
    const item = prNoticeItemOf([
      prEntry({ key: 'evt_1' }),
      prEntry({ key: 'evt_2', failed: true }),
      prEntry({ key: 'evt_3' }),
    ])

    expect(item?.title).toBe('PR #42: 3 updates · 1 needs attention')
    expect(item?.tone).toBe(ENoticeTone.Failed)
    expect(item?.contexts?.map((context) => context.note)).toEqual([undefined, 'failed', undefined])
  })

  it('pluralizes the attention count', () => {
    const item = prNoticeItemOf([
      prEntry({ key: 'evt_1', failed: true }),
      prEntry({ key: 'evt_2', failed: true }),
    ])

    expect(item?.title).toBe('PR #42: 2 updates · 2 need attention')
  })
})
