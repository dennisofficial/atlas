import { describe, expect, it } from 'bun:test'

import { createActivityReporter, type ActivityState } from '../serve-activity-reporter'
import { EServeEvent, type ServeLogLine } from '../serve-log'

const harness = (options?: { failures?: number }) => {
  const sent: ActivityState[] = []
  const lines: ServeLogLine[] = []
  const gates: (() => void)[] = []
  let failures = options?.failures ?? 0
  const reporter = createActivityReporter({
    log: (line) => lines.push(line),
    send: async (state) => {
      sent.push(state)
      if (failures > 0) {
        failures -= 1
        throw new Error('offline')
      }
    },
  })
  return { reporter, sent, lines, gates }
}

const idle = { working: false, awaiting: null } as const
const busy = { working: true, awaiting: null } as const

describe('createActivityReporter', () => {
  it('coalesces reports made while a send is in flight into one follow-up with the latest', async () => {
    const sent: ActivityState[] = []
    let release: () => void = () => undefined
    const reporter = createActivityReporter({
      log: () => undefined,
      send: async (state) => {
        sent.push(state)
        if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve))
      },
    })

    reporter.report(busy)
    await Promise.resolve()
    await Promise.resolve()
    reporter.report({ working: true, awaiting: 'input' })
    reporter.report({ working: true, awaiting: 'approval' })
    reporter.report(idle)
    release()
    await reporter.whenIdle()

    expect(sent).toEqual([busy, idle])
  })

  it('skips a state identical to the last one sent', async () => {
    const { reporter, sent } = harness()

    reporter.report(busy)
    await reporter.whenIdle()
    reporter.report({ ...busy })
    await reporter.whenIdle()

    expect(sent).toEqual([busy])
  })

  it('logs a failed send without throwing and retries on the next report', async () => {
    const { reporter, sent, lines } = harness({ failures: 1 })

    reporter.report(busy)
    await reporter.whenIdle()
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.ActivityReportFailed])

    reporter.report(busy)
    await reporter.whenIdle()
    expect(sent).toEqual([busy, busy])
  })
})
