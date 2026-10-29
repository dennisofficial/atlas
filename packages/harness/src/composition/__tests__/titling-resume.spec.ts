import { toRunId, toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { PauseSignal } from '../../loop/pause-signal'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { TurnRunner } from '../../loop/turn-runner.port'
import { CountingIds, openStoreFixture } from '../../store/__tests__/harness'
import { TitlingTurnRunner } from '../titling-turn-runner'
import { recordingNotices } from './fakes'

const done: TurnOutcome = { status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') }

class SettledRunner extends TurnRunner {
  say(): Promise<TurnOutcome> {
    return Promise.resolve(done)
  }

  runTurn(): Promise<TurnOutcome> {
    return Promise.resolve(done)
  }

  resume(_args: { pause?: PauseSignal }): Promise<TurnOutcome> {
    return Promise.resolve(done)
  }
}

async function openThread(args: { title?: string }) {
  const fixture = openStoreFixture()
  const threadId = toThreadId('titling-resume')
  await fixture.threads.createWithFirstEvents({
    threadId,
    runId: new CountingIds('titling-resume').nextRunId(),
    title: args.title,
    drafts: [{ type: 'user-said', text: 'fix the login bug' }],
  })
  return { fixture, threadId }
}

function runnerOver(args: {
  fixture: Awaited<ReturnType<typeof openThread>>['fixture']
  titler: () => Promise<string | null>
}) {
  return new TitlingTurnRunner({
    inner: new SettledRunner(),
    log: args.fixture.log,
    threads: args.fixture.threads,
    titler: args.titler,
    notice: recordingNotices().port,
  })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('titling on resume', () => {
  it('names an unnamed thread whose first message is already in the log', async () => {
    const { fixture, threadId } = await openThread({})
    const calls: string[] = []
    const runner = runnerOver({
      fixture,
      titler: async () => {
        calls.push('asked')
        return 'Fix login bug'
      },
    })

    await runner.resume({ threadId })
    await settle()

    expect(calls).toHaveLength(1)
    expect((await fixture.threads.find({ threadId }))?.title).toBe('Fix login bug')
    await fixture.close()
  })

  it('does not call the titler for a thread that already has a title', async () => {
    const { fixture, threadId } = await openThread({ title: 'Existing' })
    let calls = 0
    const runner = runnerOver({
      fixture,
      titler: async () => {
        calls += 1
        return 'Other'
      },
    })

    await runner.resume({ threadId })
    await settle()

    expect(calls).toBe(0)
    expect((await fixture.threads.find({ threadId }))?.title).toBe('Existing')
    await fixture.close()
  })
})
