import { describe, expect, it } from 'bun:test'
import type { BlockingCommand } from '@dltech/atlas-client/stream'

import {
  HIDDEN_STATUS,
  presenceOf,
  settledPresenceOf,
  statusExtentOf,
  statusLabelOf,
  statusOpacityOf,
} from '../blocking-status-model'

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
    expect(presenceOf({ presence: HIDDEN_STATUS, command: summarise })).toEqual({
      command: summarise,
      leaving: false,
    })
  })

  it('keeps the last command on screen while the status fades out', () => {
    const shown = presenceOf({ presence: HIDDEN_STATUS, command: summarise })
    expect(presenceOf({ presence: shown, command: undefined })).toEqual({
      command: summarise,
      leaving: true,
    })
  })

  it('stays hidden when nothing runs', () => {
    expect(presenceOf({ presence: HIDDEN_STATUS, command: undefined })).toBe(HIDDEN_STATUS)
  })

  it('brings a leaving status back for the next command', () => {
    const leaving = { command: summarise, leaving: true }
    expect(presenceOf({ presence: leaving, command: rotate })).toEqual({
      command: rotate,
      leaving: false,
    })
  })
})

describe('settledPresenceOf', () => {
  it('hides the status once it has faded out', () => {
    expect(settledPresenceOf({ command: summarise, leaving: true })).toBe(HIDDEN_STATUS)
  })

  it('keeps a status that is still shown', () => {
    const shown = { command: summarise, leaving: false }
    expect(settledPresenceOf(shown)).toBe(shown)
  })
})

describe('statusExtentOf', () => {
  it('takes no room before it shows', () => {
    expect(statusExtentOf({ height: 48, shown: 0, reduced: false })).toBe(0)
  })

  it('opens the room first so the composer grows before the text fades in', () => {
    expect(statusExtentOf({ height: 48, shown: 0.3, reduced: false })).toBe(24)
    expect(statusExtentOf({ height: 48, shown: 0.6, reduced: false })).toBe(48)
    expect(statusExtentOf({ height: 48, shown: 1, reduced: false })).toBe(48)
  })

  it('takes its room at once when Reduce Motion is on', () => {
    expect(statusExtentOf({ height: 48, shown: 0.1, reduced: true })).toBe(48)
    expect(statusExtentOf({ height: 48, shown: 0, reduced: true })).toBe(0)
  })
})

describe('statusOpacityOf', () => {
  it('stays clear while the room opens', () => {
    expect(statusOpacityOf({ shown: 0.4, reduced: false })).toBe(0)
  })

  it('fades in over the rest of the show', () => {
    expect(statusOpacityOf({ shown: 0.7, reduced: false })).toBeCloseTo(0.5)
    expect(statusOpacityOf({ shown: 1, reduced: false })).toBe(1)
  })

  it('fades over the whole show when Reduce Motion is on', () => {
    expect(statusOpacityOf({ shown: 0.25, reduced: true })).toBe(0.25)
  })
})

describe('statusLabelOf', () => {
  it('reads what runs, the elapsed time and the send note', () => {
    const now = Date.parse('2026-11-27T10:01:05.000Z')
    expect(statusLabelOf({ command: summarise, now })).toBe(
      'Summarising history, 1:05. Messages you send now wait for it',
    )
  })
})
