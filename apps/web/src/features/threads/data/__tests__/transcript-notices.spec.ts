import { describe, expect, it } from 'bun:test'

import { EEntryKind, EAuthor, type TranscriptEntry } from '@dltech/atlas-client/transcript'

import { ENoticeTone, ETranscriptKind } from '../transcript-kind'
import { noticeItemOf } from '../transcript-notices'

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
