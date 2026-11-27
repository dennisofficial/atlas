import { describe, expect, it } from 'bun:test'
import type { BlockingCommand } from '@dltech/atlas-client/stream'

import {
  HIDDEN_STRIP,
  presenceOf,
  settledPresenceOf,
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

describe('stripLabelOf', () => {
  it('reads what runs, the elapsed time and the send note', () => {
    const now = Date.parse('2026-11-27T10:01:05.000Z')
    expect(stripLabelOf({ command: summarise, now })).toBe(
      'Summarising history, 1:05. Messages you send now wait for it',
    )
  })
})
