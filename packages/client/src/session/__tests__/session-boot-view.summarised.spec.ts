import { describe, expect, it } from 'bun:test'

import { applyPage, EMPTY_WINDOW } from '../../stream'
import {
  chainEvents,
  chainHash,
  ECompactionAnchor,
  ESessionStatus,
  EWorkspaceStep,
  EWorkspaceStepState,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { EBootStepState } from '@dltech/atlas-wire/web'

import { sessionBootViewOf } from '../session-boot-view'

const step = (name: EWorkspaceStep, state: EWorkspaceStepState): RecordEventBody => ({
  type: 'workspace-step',
  step: name,
  state,
  ...(name === EWorkspaceStep.Setup ? { command: 'bun i' } : {}),
})

describe('sessionBootViewOf after a summary', () => {
  it('reads the setup as done when a summary hid its ending from the transcript', () => {
    const events = chainEvents({
      threadId: toThreadId('t'),
      runId: toRunId('r'),
      epoch: 1,
      at: '2026-11-06T10:00:00.000Z',
      bodies: [
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Setup, EWorkspaceStepState.Started),
        { type: 'user-said', text: 'go' },
        step(EWorkspaceStep.Setup, EWorkspaceStepState.Done),
        { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
        { type: 'user-said', text: 'next' },
        {
          type: 'history-summarised',
          fromSeq: 6,
          throughSeq: 7,
          anchor: ECompactionAnchor.Prefix,
          summary: 'earlier work',
        },
      ],
    })
    const last = events[events.length - 1] as (typeof events)[number]
    const window = applyPage({
      window: EMPTY_WINDOW,
      page: { events, head: { seq: last.seq, hash: chainHash(last) } },
    })
    const status = {
      state: ESessionStatus.Preparing,
      lease: { epoch: 1, holderHostId: 1, live: true },
    }

    expect(sessionBootViewOf({ events: window.events, status })?.state).toBe(EBootStepState.Running)
    const view = sessionBootViewOf({ events: window.foldable, status })
    expect(view?.steps[3]?.state).toBe(EBootStepState.Done)
    expect(view?.state).toBe(EBootStepState.Done)
  })
})
