import {
  ETurnStatus,
  OPERATOR_STOP_REASON,
  PauseSignal,
  type LoopTurnRunner,
  type TurnOutcome,
} from '@dltech/atlas-agent'
import { toRunId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { HeldTurns } from '../held-turns'
import type { TurnEndedArgs } from '../turn-ended-hook'
import { FakeLog, THREAD, depsOf, openTurnIn } from './turn-log-fixture'

const RUN = toRunId('run-1')
const SESSION = 'session-turns'

const runnerOf = (outcome: TurnOutcome): LoopTurnRunner =>
  ({
    runTurn: () => Promise.resolve(outcome),
    resume: () => Promise.resolve(outcome),
  }) as unknown as LoopTurnRunner

const setup = (
  over: { failure?: Error; events?: TurnFinishedEvents } = {},
): {
  ended: TurnEndedArgs[]
  log: FakeLog
  turns: HeldTurns
} => {
  const ended: TurnEndedArgs[] = []
  const log = new FakeLog(THREAD, over.events ?? [])
  const turns = new HeldTurns(
    depsOf({
      turnEnded: async (args) => {
        ended.push(args)
        if (over.failure !== undefined) throw over.failure
      },
    }),
  )
  return { ended, log, turns }
}

type TurnFinishedEvents = ReturnType<typeof openTurnIn>

const drive = (args: { turns: HeldTurns; log: FakeLog; outcome: TurnOutcome }): Promise<void> =>
  args.turns.drive({
    runner: runnerOf(args.outcome),
    record: args.log,
    threadId: THREAD,
    pause: new PauseSignal(),
    resume: false,
  })

const settled = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('report a turn end', () => {
  it('reports one finished turn once', async () => {
    const { ended, log, turns } = setup()

    await drive({ turns, log, outcome: { status: ETurnStatus.Completed, runId: RUN } })
    await settled()

    expect(ended).toEqual([{ sessionId: SESSION, threadId: THREAD }])
  })

  it('reports nothing when the turn has no ending', async () => {
    const { ended, log, turns } = setup()

    await drive({ turns, log, outcome: { status: ETurnStatus.HandoffPaused, runId: RUN } })
    await settled()

    expect(ended).toEqual([])
  })

  it('reports nothing when the turn-ended append is refused', async () => {
    const { ended, log, turns } = setup()
    log.failAppend = true

    await drive({ turns, log, outcome: { status: ETurnStatus.Completed, runId: RUN } })
    await settled()

    expect(ended).toEqual([])
  })

  it('keeps the turn green when the report fails', async () => {
    const { log, turns } = setup({ failure: new Error('usage refused') })

    await drive({ turns, log, outcome: { status: ETurnStatus.Completed, runId: RUN } })
    await settled()

    expect(log.appended.map((draft) => draft.type)).toEqual(['turn-started', 'turn-ended'])
    expect(turns.turnRunning).toBe(false)
  })

  it('reports the stopped turn the operator ends', async () => {
    const { ended, log, turns } = setup()
    const running = drive({
      turns,
      log,
      outcome: { status: ETurnStatus.Interrupted, runId: RUN, committed: false },
    })
    turns.abort(OPERATOR_STOP_REASON)
    await running
    await settled()

    expect(ended).toEqual([{ sessionId: SESSION, threadId: THREAD }])
  })
})
