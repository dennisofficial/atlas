import { describe, expect, it } from 'bun:test'

import { EEntryKind, type TranscriptEntry } from '@dltech/atlas-client/transcript'

import { ENoticeTone, ERowKind, rowsOf } from '../rows'
import { sampleEntryOf } from './entry-samples'

const ENDS_THE_WORK_ROW = EEntryKind.TurnEnded

const SKIPPED_ON_THEIR_OWN: ReadonlySet<EEntryKind> = new Set([ENDS_THE_WORK_ROW])

const rowsFor = (entries: readonly TranscriptEntry[]) =>
  rowsOf({ entries, working: false, now: Date.parse('2026-11-27T10:00:00.000Z') })

describe('rowsOf covers every entry kind', () => {
  for (const kind of Object.values(EEntryKind)) {
    it(`${kind} renders a row or is an explicit skip`, () => {
      const rows = rowsFor([sampleEntryOf[kind]])
      if (SKIPPED_ON_THEIR_OWN.has(kind)) {
        expect(rows).toEqual([])
        return
      }
      expect(rows.length).toBeGreaterThan(0)
    })
  }

  it('renders an entry kind it does not know as a quiet notice', () => {
    const unknown = {
      ...sampleEntryOf[EEntryKind.OperatorInput],
      kind: 'future-kind',
      key: 'future',
      text: 'Something new happened',
    } as unknown as TranscriptEntry
    expect(rowsFor([unknown])).toEqual([
      {
        kind: ERowKind.Notice,
        id: 'future',
        at: undefined,
        title: 'Something new happened',
        body: '',
        tone: ENoticeTone.Quiet,
      },
    ])
  })

  it('skips an unknown entry with no text', () => {
    const blank = {
      ...sampleEntryOf[EEntryKind.OperatorInput],
      kind: 'future-kind',
      text: '  ',
    } as unknown as TranscriptEntry
    expect(rowsFor([blank])).toEqual([])
  })

  it('keeps a pending operator request off the transcript', () => {
    const pending = { ...sampleEntryOf[EEntryKind.OperatorRequest], state: 'pending' as const }
    expect(rowsFor([pending])).toEqual([])
  })
})

describe('rowsOf for a sign-in', () => {
  const signIn = sampleEntryOf[EEntryKind.SignIn]

  it('asks for a sign-in while the result is open', () => {
    expect(rowsFor([signIn])).toEqual([
      {
        kind: ERowKind.SignIn,
        id: 'sign-in',
        at: undefined,
        subject: 'Linear',
        url: 'https://mcp.linear.app/authorize?state=s',
        result: undefined,
        reason: undefined,
      },
    ])
  })

  it('carries the failure reason', () => {
    expect(rowsFor([{ ...signIn, result: 'failed', reason: 'access denied' }])[0]).toMatchObject({
      kind: ERowKind.SignIn,
      result: 'failed',
      reason: 'access denied',
    })
  })

  it('ends a running work row before the sign-in', () => {
    const rows = rowsFor([sampleEntryOf[EEntryKind.ModelThought], signIn])
    expect(rows.map((row) => row.kind)).toEqual([ERowKind.Work, ERowKind.SignIn])
  })
})
