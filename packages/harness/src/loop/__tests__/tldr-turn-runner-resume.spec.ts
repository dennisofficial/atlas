import { describe, expect, it } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'

import {
  EventLogPort,
  IdPort,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
} from '@dltech/atlas-core'

import { ETurnStatus, TldrTurnRunner, TurnRunner, type TurnOutcome } from '..'
import { PauseSignal } from '../pause-signal'

const THREAD = toThreadId('thread-1')
const RUN = toRunId('run-1')

class EmptyLog extends EventLogPort {
  append(): Promise<Event[]> {
    return Promise.resolve([])
  }
  replace(): Promise<Event[]> {
    return Promise.resolve([])
  }
  read(): Promise<Event[]> {
    return Promise.resolve([])
  }
  refresh(): Promise<void> {
    return Promise.resolve()
  }
  head(): Promise<number> {
    return Promise.resolve(0)
  }
  readOwn(): Promise<Event[]> {
    return Promise.resolve([])
  }
}

class FixedIds extends IdPort {
  nextThreadId() {
    return THREAD
  }
  nextRunId() {
    return RUN
  }
  nextEventId() {
    return toEventId('evt-1')
  }
  nextCallId() {
    return toCallId('call-1')
  }
}

class PauseRecordingRunner extends TurnRunner {
  readonly resumedWith: (PauseSignal | undefined)[] = []

  say(): Promise<TurnOutcome> {
    return Promise.resolve({ status: ETurnStatus.RelocationPaused, runId: RUN })
  }

  runTurn(): Promise<TurnOutcome> {
    return this.say()
  }

  resume(args: { pause?: PauseSignal }): Promise<TurnOutcome> {
    this.resumedWith.push(args.pause)
    return this.say()
  }
}

describe('TldrTurnRunner resume', () => {
  it('passes the caller\'s exact pause signal to the inner runner and answers its outcome', async () => {
    const inner = new PauseRecordingRunner()
    const runner = new TldrTurnRunner({
      inner,
      log: new EmptyLog(),
      ids: new FixedIds(),
      model: new MockLanguageModelV4(),
      modelId: () => 'test-model',
    })
    const pause = new PauseSignal()
    pause.pause()

    const outcome = await runner.resume({ threadId: THREAD, pause })

    expect(outcome.status).toBe(ETurnStatus.RelocationPaused)
    expect(inner.resumedWith[0]).toBe(pause)
  })
})
