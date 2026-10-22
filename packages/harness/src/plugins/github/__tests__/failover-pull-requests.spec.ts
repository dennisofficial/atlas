import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-core'
import { describe, expect, it } from 'vitest'

import {
  EFailoverState,
  FailoverPullRequestPort,
  PROBE_INTERVAL_MS,
} from '../failover-pull-requests'
import { PullRequestPort, type PullRequestReading } from '../pure'
import {
  aCheckout,
  stoppedClock,
  WAS_ABSENT as ABSENT,
  wasFound as found,
  wasUnavailable as unavailable,
} from '../testing'

class ScriptedPort extends PullRequestPort {
  readonly pushes = false
  reading: PullRequestReading
  asked = 0
  disposed = 0

  constructor(reading: PullRequestReading) {
    super()
    this.reading = reading
  }

  async read(): Promise<PullRequestReading> {
    this.asked += 1
    return this.reading
  }

  async readLinked(): Promise<PullRequestReading> {
    this.asked += 1
    return this.reading
  }

  dispose(): void {
    this.disposed += 1
  }
}

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const composite = (args: { primary: PullRequestReading; fallback: PullRequestReading }) => {
  const primary = new ScriptedPort(args.primary)
  const fallback = new ScriptedPort(args.fallback)
  const log = new RecordingLog()
  const time = stoppedClock(1_000_000)
  const transitions: EFailoverState[] = []
  const port = new FailoverPullRequestPort({
    primary,
    fallback,
    log: { port: log },
    now: time.now,
    onTransition: (state) => transitions.push(state),
  })
  const flips: boolean[] = []
  port.onPushesChanged((): void => {
    flips.push(port.pushes)
  })

  return { port, primary, fallback, log, time, transitions, flips }
}

const checkout = aCheckout()

describe('FailoverPullRequestPort', () => {
  it('returns a Found primary answer verbatim and never asks the fallback', async () => {
    const { port, primary, fallback } = composite({ primary: found(), fallback: ABSENT })

    expect(await port.read({ checkout })).toEqual(found())
    expect(await port.readLinked({ repo: 'github.com/a/b', number: 1 })).toEqual(found())

    expect(primary.asked).toBe(2)
    expect(fallback.asked).toBe(0)
    expect(port.pushes).toBe(true)
  })

  it('flips to polling on a retryable Unavailable and answers from the fallback', async () => {
    const { port, fallback, log, flips } = composite({
      primary: unavailable(true),
      fallback: found({ number: 7 }),
    })

    expect(await port.read({ checkout })).toEqual(found({ number: 7 }))

    expect(fallback.asked).toBe(1)
    expect(port.pushes).toBe(false)
    expect(flips).toEqual([false])
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.source).toBe('cloud.pull-requests')
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Warn)
  })

  it('returns a non-retryable Unavailable as-is without failing over', async () => {
    const { port, fallback, log } = composite({ primary: unavailable(false), fallback: found() })

    expect(await port.read({ checkout })).toEqual(unavailable(false))

    expect(fallback.asked).toBe(0)
    expect(port.pushes).toBe(true)
    expect(log.entries).toEqual([])
  })

  it('probes the primary once per interval while polling, not once per read', async () => {
    const { port, primary, fallback, time } = composite({
      primary: unavailable(true),
      fallback: ABSENT,
    })
    await port.read({ checkout })
    primary.asked = 0

    await port.read({ checkout })
    time.advance(PROBE_INTERVAL_MS - 1)
    await port.read({ checkout })
    expect(primary.asked).toBe(0)

    time.advance(1)
    await port.read({ checkout })
    await port.read({ checkout })
    await Promise.resolve()

    expect(primary.asked).toBe(1)
    expect(fallback.asked).toBe(5)
  })

  it('returns to realtime when a probe gets a real answer, notifying both directions', async () => {
    const { port, primary, log, time, transitions, flips } = composite({
      primary: unavailable(true),
      fallback: ABSENT,
    })
    await port.read({ checkout })

    primary.reading = found()
    time.advance(PROBE_INTERVAL_MS)
    await port.read({ checkout })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(port.pushes).toBe(true)
    expect(flips).toEqual([false, true])
    expect(transitions).toEqual([EFailoverState.Polling, EFailoverState.Realtime])
    expect(log.entries).toHaveLength(2)
    expect(log.entries[1]?.severity).toBe(ELogSeverity.Info)
  })

  it('stays polling when a probe is Unavailable, without a probe storm', async () => {
    const { port, primary, time, flips } = composite({
      primary: unavailable(true),
      fallback: ABSENT,
    })
    await port.read({ checkout })
    primary.asked = 0

    time.advance(PROBE_INTERVAL_MS)
    for (let index = 0; index < 5; index += 1) await port.read({ checkout })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(primary.asked).toBe(1)
    expect(port.pushes).toBe(false)
    expect(flips).toEqual([false])
  })

  it('disposes the primary', async () => {
    const { port, primary } = composite({ primary: found(), fallback: ABSENT })

    port.dispose()

    expect(primary.disposed).toBe(1)
  })
})
