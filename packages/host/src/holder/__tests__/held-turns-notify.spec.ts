import {
  ETurnStatus,
  OPERATOR_STOP_REASON,
  PauseSignal,
  type LoopTurnRunner,
  type TurnOutcome,
} from '@dltech/atlas-agent'
import {
  ENotifyMoment,
  ENotifyVerdict,
  EPendingWork,
  ETurnEndedBy,
  ETurnOutcome,
  toCallId,
  toEventId,
  toRunId,
  type RecordEvent,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { HeldTurns } from '../held-turns'
import type { NotifyDispatchArgs } from '../notify-dispatch'
import { AT, FakeLog, THREAD, depsOf, openTurnIn } from './turn-log-fixture'

const RUN = toRunId('run-1')
const SESSION = 'session-turns'

const runnerOf = (outcome: TurnOutcome): LoopTurnRunner =>
  ({
    runTurn: () => Promise.resolve(outcome),
    resume: () => Promise.resolve(outcome),
  }) as unknown as LoopTurnRunner

const openShellEvents = (): RecordEvent[] =>
  [
    {
      type: 'background-shell-started',
      shellId: 'shell-1',
      command: 'bun test',
      id: toEventId('event-shell'),
      seq: 1,
      at: AT,
      threadId: THREAD,
    },
  ] as RecordEvent[]

const parkedEvents = (): RecordEvent[] =>
  [
    ...openTurnIn('turn-parked'),
    {
      type: 'tool-parked',
      callId: toCallId('call-parked'),
      name: 'bash',
      id: toEventId('event-parked'),
      seq: 2,
      at: AT,
      threadId: THREAD,
    },
  ] as RecordEvent[]

const setup = (
  over: { events?: RecordEvent[]; headSeq?: number; failure?: Error } = {},
): { sent: NotifyDispatchArgs[]; log: FakeLog; turns: HeldTurns } => {
  const sent: NotifyDispatchArgs[] = []
  const log = new FakeLog(THREAD, over.events ?? [])
  log.headSeq = over.headSeq ?? 9
  const turns = new HeldTurns(
    depsOf({
      notify: async (payload) => {
        if (over.failure !== undefined) throw over.failure
        sent.push(payload)
      },
    }),
  )
  return { sent, log, turns }
}

const drive = (args: { turns: HeldTurns; log: FakeLog; outcome: TurnOutcome }): Promise<void> =>
  args.turns.drive({
    runner: runnerOf(args.outcome),
    record: args.log,
    threadId: THREAD,
    pause: new PauseSignal(),
    resume: false,
  })

describe('notify on a turn boundary', () => {
  it('dispatches one job when a turn ends', async () => {
    const { sent, log, turns } = setup()

    await drive({ turns, log, outcome: { status: ETurnStatus.Completed, runId: RUN } })

    expect(sent).toEqual([
      {
        sessionId: SESSION,
        threadId: THREAD,
        seq: 9,
        moment: ENotifyMoment.TurnFinished,
        decision: {
          moment: ENotifyMoment.TurnFinished,
          verdict: ENotifyVerdict.Send,
          holdMs: 0,
          pending: [],
          operatorTurn: false,
        },
      },
    ])
  })

  it('holds the finished moment while a shell is open, and records the facts on the turn', async () => {
    const { sent, log, turns } = setup({ events: openShellEvents(), headSeq: 12 })

    await drive({ turns, log, outcome: { status: ETurnStatus.Completed, runId: RUN } })

    expect(sent[0]?.decision).toEqual({
      moment: ENotifyMoment.TurnFinished,
      verdict: ENotifyVerdict.Hold,
      holdMs: 3_600_000,
      pending: [EPendingWork.Shell],
      operatorTurn: false,
    })
    expect(log.appended.at(-1)).toEqual({
      type: 'turn-ended',
      turnId: 'turn-event-1',
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
      notify: { pending: [EPendingWork.Shell], operatorTurn: false },
    })
  })

  it('dispatches a failed moment when the turn failed', async () => {
    const { sent, log, turns } = setup()

    await drive({
      turns,
      log,
      outcome: { status: ETurnStatus.Failed, runId: RUN, message: 'boom', cause: 'boom' },
    })

    expect(sent).toEqual([
      {
        sessionId: SESSION,
        threadId: THREAD,
        seq: 9,
        moment: ENotifyMoment.TurnFailed,
        decision: {
          moment: ENotifyMoment.TurnFailed,
          verdict: ENotifyVerdict.Send,
          holdMs: 0,
          pending: [],
          operatorTurn: false,
        },
      },
    ])
  })

  it('dispatches waiting-for-you when the turn parks for the operator', async () => {
    const { sent, log, turns } = setup({ events: parkedEvents(), headSeq: 12 })

    await drive({
      turns,
      log,
      outcome: { status: ETurnStatus.Parked, runId: RUN, callId: toCallId('call-parked') },
    })

    expect(sent).toEqual([
      {
        sessionId: SESSION,
        threadId: THREAD,
        seq: 12,
        moment: ENotifyMoment.WaitingForYou,
        decision: {
          moment: ENotifyMoment.WaitingForYou,
          verdict: ENotifyVerdict.Send,
          holdMs: 0,
          pending: [],
          operatorTurn: false,
        },
      },
    ])
  })

  it('dispatches nothing when the operator stops the turn', async () => {
    const { sent, log, turns } = setup()
    const running = drive({
      turns,
      log,
      outcome: { status: ETurnStatus.Interrupted, runId: RUN, committed: false },
    })
    turns.abort(OPERATOR_STOP_REASON)
    await running

    expect(sent).toEqual([])
  })

  it('dispatches nothing when the turn-ended append is refused', async () => {
    const { sent, log, turns } = setup()
    log.failAppend = true

    await drive({ turns, log, outcome: { status: ETurnStatus.Completed, runId: RUN } })

    expect(sent).toEqual([])
  })

  it('keeps the turn green when the dispatch fails', async () => {
    const { log, turns } = setup({ failure: new Error('trigger refused') })

    await drive({ turns, log, outcome: { status: ETurnStatus.Completed, runId: RUN } })

    expect(log.appended.map((draft) => draft.type)).toEqual(['turn-started', 'turn-ended'])
    expect(turns.turnRunning).toBe(false)
  })
})
