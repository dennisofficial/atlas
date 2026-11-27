import { describe, expect, it } from 'bun:test'
import type { BlockingCommand } from '@dltech/atlas-client/stream'

import {
  HIDDEN_STRIP,
  presenceOf,
  STRIP_OVERLAP,
  settledPresenceOf,
  stripExtentOf,
  stripLabelOf,
  stripRiseOf,
} from '../blocking-strip-model'

const summarise: BlockingCommand = {
  inboxId: 7,
  name: 'summarise',
  startedAt: '2026-11-27T10:00:00.000Z',
  copy: { label: 'Summarising history', queued: 'Waits for the summary' },
}

const rotate: BlockingCommand = {
  ...summarise,
  inboxId: 8,
  name: 'rotate',
  copy: { label: 'Starting a fresh context', queued: 'Waits for the fresh context' },
}

describe('presenceOf', () => {
  it('shows a command that starts', () => {
    expect(presenceOf({ presence: HIDDEN_STRIP, command: summarise })).toEqual({
      command: summarise,
      leaving: false,
    })
  })

  it('keeps the last command on screen while the strip leaves', () => {
    const shown = presenceOf({ presence: HIDDEN_STRIP, command: summarise })
    expect(presenceOf({ presence: shown, command: undefined })).toEqual({
      command: summarise,
      leaving: true,
    })
  })

  it('stays hidden when nothing runs', () => {
    expect(presenceOf({ presence: HIDDEN_STRIP, command: undefined })).toBe(HIDDEN_STRIP)
  })

  it('brings a leaving strip back for the next command', () => {
    const leaving = { command: summarise, leaving: true }
    expect(presenceOf({ presence: leaving, command: rotate })).toEqual({
      command: rotate,
      leaving: false,
    })
  })
})

describe('settledPresenceOf', () => {
  it('hides the strip once it has left', () => {
    expect(settledPresenceOf({ command: summarise, leaving: true })).toBe(HIDDEN_STRIP)
  })

  it('keeps a strip that is still shown', () => {
    const shown = { command: summarise, leaving: false }
    expect(settledPresenceOf(shown)).toBe(shown)
  })
})

describe('stripRiseOf', () => {
  it('rises by its own height from behind the composer', () => {
    expect(stripRiseOf({ height: 64, reduced: false })).toBe(64)
  })

  it('does not move when Reduce Motion is on', () => {
    expect(stripRiseOf({ height: 64, reduced: true })).toBe(0)
  })
})

describe('stripExtentOf', () => {
  const height = STRIP_OVERLAP + 48

  it('takes no room before it rises', () => {
    expect(stripExtentOf({ height, shown: 0, reduced: false })).toBe(0)
  })

  it('grows with the rise so the rows above ride on the card', () => {
    expect(stripExtentOf({ height, shown: 0.5, reduced: false })).toBe(24)
  })

  it('takes only the part above the composer once shown', () => {
    expect(stripExtentOf({ height, shown: 1, reduced: false })).toBe(48)
  })

  it('does not bounce the rows above when the spring overshoots', () => {
    expect(stripExtentOf({ height, shown: 1.08, reduced: false })).toBe(48)
  })

  it('takes its room at once when Reduce Motion is on', () => {
    expect(stripExtentOf({ height, shown: 0.2, reduced: true })).toBe(48)
    expect(stripExtentOf({ height, shown: 0, reduced: true })).toBe(0)
  })

  it('takes no room before the card is measured', () => {
    expect(stripExtentOf({ height: 0, shown: 1, reduced: false })).toBe(0)
  })
})

describe('stripLabelOf', () => {
  it('reads what runs, the elapsed time and the send note', () => {
    const now = Date.parse('2026-11-27T10:01:05.000Z')
    expect(stripLabelOf({ command: summarise, now })).toBe(
      'Summarising history, 1:05. Messages you send now wait for it',
    )
  })
})
