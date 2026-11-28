import { describe, expect, it } from 'bun:test'

import type { RewindKillRow } from '@dltech/atlas-client/session'
import type { SummariseReach } from '@dltech/atlas-core'

import {
  EMessageAction,
  messageActionLabelOf,
  messageActionsOf,
  REWIND_CONFIRM_DESCRIPTION,
  REWIND_CONFIRM_TITLE,
  rewindConfirmOf,
} from '../message-actions'
import { EMessageAuthor, ERowKind, type MessageRow } from '../rows'

const rowOf = (overrides: Partial<MessageRow>): MessageRow => ({
  kind: ERowKind.Message,
  id: 'evt_1',
  author: EMessageAuthor.You,
  at: undefined,
  text: 'hello',
  streaming: false,
  steer: false,
  attachments: [],
  ...overrides,
})

const reach = (throughSeq: number, messages: number): SummariseReach => ({ throughSeq, messages })

const pointsOf = (...eventIds: readonly string[]): ReadonlySet<string> => new Set(eventIds)

const summarisePointsOf = (
  ...entries: readonly [string, SummariseReach][]
): ReadonlyMap<string, SummariseReach> => new Map(entries)

describe('messageActionsOf', () => {
  it('offers copy on an assistant message', () => {
    const actions = messageActionsOf({
      row: rowOf({ author: EMessageAuthor.Atlas, text: 'done' }),
      queued: false,
      rewindPoints: undefined,
      summarisePoints: undefined,
    })
    expect(actions).toEqual([EMessageAction.Copy])
  })

  it('offers nothing on a streaming assistant message', () => {
    const actions = messageActionsOf({
      row: rowOf({ author: EMessageAuthor.Atlas, streaming: true }),
      queued: false,
      rewindPoints: undefined,
      summarisePoints: undefined,
    })
    expect(actions).toEqual([])
  })

  it('offers copy on an inbound agent message', () => {
    const actions = messageActionsOf({
      row: rowOf({
        author: EMessageAuthor.Atlas,
        sender: 'Explorer',
        senderSessionId: null,
      }),
      queued: false,
      rewindPoints: undefined,
      summarisePoints: undefined,
    })
    expect(actions).toEqual([EMessageAction.Copy])
  })

  it('offers copy, rewind and summarise on a user message with both points', () => {
    const actions = messageActionsOf({
      row: rowOf({}),
      queued: false,
      rewindPoints: pointsOf('evt_1'),
      summarisePoints: summarisePointsOf(['evt_1', reach(4, 1)]),
    })
    expect(actions).toEqual([EMessageAction.Copy, EMessageAction.Rewind, EMessageAction.Summarise])
  })

  it('resolves the event id past the entry key suffix', () => {
    const actions = messageActionsOf({
      row: rowOf({ id: 'evt_1#3' }),
      queued: false,
      rewindPoints: pointsOf('evt_1'),
      summarisePoints: summarisePointsOf(['evt_1', reach(4, 1)]),
    })
    expect(actions).toEqual([EMessageAction.Copy, EMessageAction.Rewind, EMessageAction.Summarise])
  })

  it('offers no copy on an attachment-only user message', () => {
    const actions = messageActionsOf({
      row: rowOf({ text: '   ' }),
      queued: false,
      rewindPoints: pointsOf('evt_1'),
      summarisePoints: summarisePointsOf(['evt_1', reach(4, 1)]),
    })
    expect(actions).toEqual([])
  })

  it('offers nothing on a command echo row', () => {
    const actions = messageActionsOf({
      row: rowOf({ command: { text: '/stop', name: 'stop' } }),
      queued: false,
      rewindPoints: pointsOf('evt_1'),
      summarisePoints: summarisePointsOf(['evt_1', reach(4, 1)]),
    })
    expect(actions).toEqual([])
  })

  it('offers nothing on a staged row', () => {
    const actions = messageActionsOf({
      row: rowOf({ staged: true }),
      queued: false,
      rewindPoints: pointsOf('evt_1'),
      summarisePoints: summarisePointsOf(['evt_1', reach(4, 1)]),
    })
    expect(actions).toEqual([])
  })

  it('offers nothing on a queued row', () => {
    const actions = messageActionsOf({
      row: rowOf({}),
      queued: true,
      rewindPoints: pointsOf('evt_1'),
      summarisePoints: summarisePointsOf(['evt_1', reach(4, 1)]),
    })
    expect(actions).toEqual([])
  })

  it('drops the actions whose point the session does not offer', () => {
    const actions = messageActionsOf({
      row: rowOf({}),
      queued: false,
      rewindPoints: pointsOf('evt_1'),
      summarisePoints: undefined,
    })
    expect(actions).toEqual([EMessageAction.Copy, EMessageAction.Rewind])
  })
})

describe('messageActionLabelOf', () => {
  it('names every action the way the web does', () => {
    expect(
      [EMessageAction.Copy, EMessageAction.Rewind, EMessageAction.Summarise].map(
        messageActionLabelOf,
      ),
    ).toEqual(['Copy', 'Rewind to here', 'Summarise up to here'])
  })
})

describe('rewindConfirmOf', () => {
  const kill = (kind: RewindKillRow['kind'], label: string, running: boolean): RewindKillRow => ({
    kind,
    label,
    running,
  })

  it('keeps only the description when nothing is killed', () => {
    expect(rewindConfirmOf([])).toEqual({
      title: REWIND_CONFIRM_TITLE,
      message: REWIND_CONFIRM_DESCRIPTION,
    })
  })

  it('lists each killed thing under the description', () => {
    expect(
      rewindConfirmOf([kill('agent', 'Fix the bug', true), kill('shell', 'bun test', false)]),
    ).toEqual({
      title: REWIND_CONFIRM_TITLE,
      message: `${REWIND_CONFIRM_DESCRIPTION}\n\nAgent: Fix the bug (running)\nShell: bun test`,
    })
  })
})
