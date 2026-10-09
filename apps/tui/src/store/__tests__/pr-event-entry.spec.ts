import { describe, expect, it } from 'bun:test'

import {
  EPrEventKind,
  EPrReviewState,
  EPrVerdict,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { isExpandable } from '../expandable'
import { transcriptNotice } from '../notice-barriers'
import { EEntryKind, type PrEventEntry } from '../transcript-model'
import { log } from './fixture'

type PrEventDraft = Extract<EventDraft, { type: 'pr-event' }>

const prEvent = (over: Partial<PrEventDraft> = {}): PrEventDraft => ({
  type: 'pr-event',
  repo: 'github.com/owner/repo',
  prNumber: 42,
  kind: EPrEventKind.Comment,
  url: 'https://github.com/owner/repo/pull/42',
  ...over,
})

const onlyPrEntry = (events: readonly Event[]): PrEventEntry => {
  const entry = durableEntries({ events }).find(
    (candidate): candidate is PrEventEntry => candidate.kind === EEntryKind.PrEvent,
  )
  if (entry === undefined) throw new Error('no pr-event entry was projected')
  return entry
}

describe('a pr-event in the transcript', () => {
  it('is its own entry, not something the operator said', () => {
    const entries = durableEntries({ events: log([prEvent()]) })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe(EEntryKind.PrEvent)
  })

  it('renders a comment as the author and the first line of the body', () => {
    const entry = onlyPrEntry(
      log([
        prEvent({
          authorLogin: 'dennis',
          body: 'This needs a second look\nand a second line',
        }),
      ]),
    )

    expect(entry.text).toBe('PR #42: dennis commented — This needs a second look')
  })

  it('clips a long first line rather than spilling it onto the row', () => {
    const entry = onlyPrEntry(
      log([prEvent({ authorLogin: 'dennis', body: 'x'.repeat(300) })]),
    )

    expect(entry.text.startsWith('PR #42: dennis commented — ')).toBe(true)
    expect(entry.text.endsWith('…')).toBe(true)
    expect(entry.text.length).toBeLessThan(160)
  })

  it('keeps the whole body for the fold, so the operator sees what the agent saw', () => {
    const body = 'first line\nsecond line\nthird line'
    const entry = onlyPrEntry(log([prEvent({ body })]))

    expect(entry.text).not.toContain('second line')
    expect(entry.body).toBe(body)
    expect(isExpandable(entry)).toBe(true)
  })

  it('does not offer a fold when the event carried no body', () => {
    expect(isExpandable(onlyPrEntry(log([prEvent({ body: undefined })])))).toBe(false)
  })

  it('renders an approval plainly', () => {
    const entry = onlyPrEntry(
      log([
        prEvent({
          kind: EPrEventKind.Review,
          authorLogin: 'dennis',
          reviewState: EPrReviewState.Approved,
        }),
      ]),
    )

    expect(entry.text).toBe('PR #42: dennis approved')
    expect(entry.failed).toBe(false)
  })

  it('renders requested changes as a failure', () => {
    const entry = onlyPrEntry(
      log([
        prEvent({
          kind: EPrEventKind.Review,
          authorLogin: 'dennis',
          reviewState: EPrReviewState.ChangesRequested,
        }),
      ]),
    )

    expect(entry.text).toBe('PR #42: dennis requested changes')
    expect(entry.failed).toBe(true)
  })

  it('renders an inline review comment with its first line', () => {
    const entry = onlyPrEntry(
      log([
        prEvent({
          kind: EPrEventKind.ReviewComment,
          authorLogin: 'dennis',
          body: 'nit: rename this\nrest of the comment',
        }),
      ]),
    )

    expect(entry.text).toBe('PR #42: dennis left an inline review comment — nit: rename this')
    expect(entry.body).toBe('nit: rename this\nrest of the comment')
  })

  it('renders a green verdict', () => {
    const entry = onlyPrEntry(
      log([prEvent({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Green })]),
    )

    expect(entry.text).toBe('PR #42: CI green')
    expect(entry.failed).toBe(false)
  })

  it('renders a failed verdict as a failure', () => {
    const entry = onlyPrEntry(
      log([prEvent({ kind: EPrEventKind.Verdict, verdict: EPrVerdict.Failed })]),
    )

    expect(entry.text).toBe('PR #42: CI failed')
    expect(entry.failed).toBe(true)
  })

  it('renders mergeability both ways', () => {
    expect(onlyPrEntry(log([prEvent({ kind: EPrEventKind.Mergeability, mergeable: true })])).text).toBe(
      'PR #42: mergeable',
    )

    const conflicted = onlyPrEntry(
      log([prEvent({ kind: EPrEventKind.Mergeability, mergeable: false })]),
    )
    expect(conflicted.text).toBe('PR #42: has conflicts')
    expect(conflicted.failed).toBe(true)
  })

  it('renders merged and closed states', () => {
    expect(onlyPrEntry(log([prEvent({ kind: EPrEventKind.State, state: 'merged' })])).text).toBe(
      'PR #42: merged',
    )
    expect(onlyPrEntry(log([prEvent({ kind: EPrEventKind.State, state: 'closed' })])).text).toBe(
      'PR #42: closed',
    )
  })

  it('breaks every run as a transcript notice', () => {
    expect(transcriptNotice(log([prEvent()])[0]!)).toBe(true)
  })

  it('never folds into the message a human typed beside it', () => {
    const entries = durableEntries({
      events: log([
        { type: 'user-said', text: 'before' },
        prEvent(),
        { type: 'user-said', text: 'after' },
      ]),
    })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.PrEvent,
      EEntryKind.OperatorSaid,
    ])
  })
})
