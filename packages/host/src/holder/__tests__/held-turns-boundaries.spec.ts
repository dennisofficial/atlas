import { ETurnStatus, type LoopTurnRunner, PauseSignal } from '@dltech/atlas-agent'
import { ETurnCause, ETurnEndedBy, ETurnOutcome, toRunId } from '@dltech/atlas-core'
import { OPERATOR_STOP_REASON } from '@dltech/atlas-agent'
import { describe, expect, it } from 'bun:test'

import { HeldTurns } from '../held-turns'
import { ETurnAborted, turnAbortedOf, turnEndingOf } from '../turn-boundary'

import { FakeLog, THREAD, depsOf, openTurnIn } from './turn-log-fixture'

const runnerOf = (outcome: unknown): LoopTurnRunner =>
  ({
    runTurn: () => Promise.resolve(outcome),
    resume: () => Promise.resolve(outcome),
  }) as unknown as LoopTurnRunner

const drive = async (args: {
  turns: HeldTurns
  log: FakeLog
  outcome?: unknown
  resume?: boolean
}): Promise<void> =>
  args.turns.drive({
    runner: runnerOf(args.outcome ?? { status: ETurnStatus.Completed, runId: toRunId('run-1') }),
    record: args.log,
    threadId: THREAD,
    pause: new PauseSignal(),
    resume: args.resume ?? false,
  })

describe('turnEndingOf', () => {
  const ending = (status: ETurnStatus, aborted: ETurnAborted) =>
    turnEndingOf({ outcome: { status, runId: toRunId('run-1') } as never, aborted })

  it('ends a completed or idle turn as completed by the agent', () => {
    expect(ending(ETurnStatus.Completed, ETurnAborted.Other)).toEqual({
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
    })
    expect(ending(ETurnStatus.Idle, ETurnAborted.Other)).toEqual({
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
    })
  })

  it('ends a failed turn as failed by the agent', () => {
    expect(ending(ETurnStatus.Failed, ETurnAborted.Other)).toEqual({
      outcome: ETurnOutcome.Failed,
      by: ETurnEndedBy.Agent,
    })
  })

  it('records an operator stop as stopped by the operator', () => {
    expect(ending(ETurnStatus.Interrupted, ETurnAborted.Stop)).toEqual({
      outcome: ETurnOutcome.Stopped,
      by: ETurnEndedBy.Operator,
    })
  })

  it('writes no ending for a handoff or a lost lease', () => {
    expect(ending(ETurnStatus.Interrupted, ETurnAborted.Handoff)).toBeNull()
    expect(ending(ETurnStatus.Interrupted, ETurnAborted.LeaseLost)).toBeNull()
  })

  it('ends any other interrupted turn as interrupted by the host', () => {
    expect(ending(ETurnStatus.Interrupted, ETurnAborted.Other)).toEqual({
      outcome: ETurnOutcome.Interrupted,
      by: ETurnEndedBy.Host,
    })
  })

  it('leaves a paused, parked, waiting or relocating turn open', () => {
    for (const status of [
      ETurnStatus.Paused,
      ETurnStatus.Parked,
      ETurnStatus.WaitingForModel,
      ETurnStatus.HandoffPaused,
    ]) {
      expect(ending(status, ETurnAborted.Other)).toBeNull()
    }
  })
})

describe('turnAbortedOf', () => {
  it('reads the stop reason, the handoff, a lost lease and anything else apart', () => {
    expect(turnAbortedOf(OPERATOR_STOP_REASON)).toBe(ETurnAborted.Stop)
    expect(turnAbortedOf('handoff')).toBe(ETurnAborted.Handoff)
    expect(turnAbortedOf(undefined)).toBe(ETurnAborted.LeaseLost)
    expect(turnAbortedOf('something else')).toBe(ETurnAborted.Other)
  })
})

describe('HeldTurns turn boundaries', () => {
  it('writes turn-started before the run and turn-ended after it', async () => {
    const log = new FakeLog()
    const turns = new HeldTurns(depsOf())

    await drive({ turns, log })

    expect(log.appended.map((draft) => draft.type)).toEqual(['turn-started', 'turn-ended'])
    const started = log.appended[0]
    const ended = log.appended[1]
    expect(started).toMatchObject({ turnId: 'turn-event-1', cause: ETurnCause.Input })
    expect(ended).toMatchObject({
      turnId: 'turn-event-1',
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
    })
  })

  it('resumes into the open turn instead of starting another one', async () => {
    const log = new FakeLog(THREAD, openTurnIn('turn-open'))
    const turns = new HeldTurns(depsOf())

    await drive({ turns, log, resume: true })

    expect(log.appended.map((draft) => draft.type)).toEqual(['turn-ended'])
    expect(log.appended[0]).toMatchObject({ turnId: 'turn-open' })
  })

  it('ends a turn the operator stopped as stopped by the operator', async () => {
    const log = new FakeLog()
    const turns = new HeldTurns(depsOf())
    const interrupted = {
      status: ETurnStatus.Interrupted,
      runId: toRunId('run-1'),
      committed: false,
    }
    const running = drive({ turns, log, outcome: interrupted })
    turns.abort(OPERATOR_STOP_REASON)
    await running

    expect(log.appended.at(-1)).toMatchObject({
      type: 'turn-ended',
      outcome: ETurnOutcome.Stopped,
      by: ETurnEndedBy.Operator,
    })
  })

  it('writes the ending before whenIdle settles and reports the turn end once', async () => {
    const log = new FakeLog()
    const turns = new HeldTurns(depsOf())
    let ends = 0
    turns.onTurnEnd = () => {
      ends += 1
    }

    const running = drive({ turns, log })
    const idle = turns.whenIdle()
    await running
    await idle

    expect(log.appended.map((draft) => draft.type)).toEqual(['turn-started', 'turn-ended'])
    expect(ends).toBe(1)
  })

  it('swallows a refused turn-ended append', async () => {
    const log = new FakeLog()
    log.failAppend = true
    const turns = new HeldTurns(depsOf())

    await drive({ turns, log })

    expect(log.appended).toEqual([])
    expect(turns.turnRunning).toBe(false)
  })

  it('ends a turn whose runner threw as failed by the host, then rethrows', async () => {
    const log = new FakeLog()
    const turns = new HeldTurns(depsOf())
    const throwing = {
      runTurn: () => Promise.reject(new Error('runner blew up')),
      resume: () => Promise.reject(new Error('runner blew up')),
    } as unknown as LoopTurnRunner

    const failed = turns.drive({
      runner: throwing,
      record: log,
      threadId: THREAD,
      pause: new PauseSignal(),
      resume: false,
    })

    await expect(failed).rejects.toThrow('runner blew up')
    expect(log.appended.at(-1)).toMatchObject({
      type: 'turn-ended',
      outcome: ETurnOutcome.Failed,
      by: ETurnEndedBy.Host,
    })
  })
})
