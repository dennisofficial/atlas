import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'
import { describe, expect, it } from 'bun:test'

import { EPodProvisionOutcome } from './pod-provision.contract'
import { runPodProvision } from './pod-provision-run'
import {
  fakeBoot,
  runDepsWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
} from './sandbox-provisioning.fixture'

const payloadOf = async () => {
  const [row] = await sandboxRows()
  return { threadId: 'thr-1', wakeClaim: row?.wakeClaim?.toISOString() ?? '' }
}

describe('runPodProvision trace', () => {
  useTestDatabase()

  it('opens one root pod.provision span, joins it on threadId and hands the tracer to the boot', async () => {
    await seedThread()
    await seedSandboxRow()
    const trace = new RecordingTracer()
    const { boot, calls } = fakeBoot()

    const output = await runPodProvision({
      payload: await payloadOf(),
      deps: runDepsWith({ boot, trace }),
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Running })
    expect(trace.spans.map((span) => span.name)).toEqual([ESpan.PodProvision])
    expect(trace.spans[0]?.parent).toBeUndefined()
    expect(trace.spans[0]?.fields).toMatchObject({ threadId: 'thr-1' })
    expect(trace.spans[0]?.ended).toBe(true)
    expect(calls[0]?.trace).toBe(trace)
  })

  it('records the span for a superseded claim and boots nothing', async () => {
    await seedThread()
    await seedSandboxRow()
    const trace = new RecordingTracer()
    const { boot, calls } = fakeBoot()

    const output = await runPodProvision({
      payload: {
        threadId: 'thr-1',
        wakeClaim: new Date(Date.parse((await payloadOf()).wakeClaim) + 5_000).toISOString(),
      },
      deps: runDepsWith({ boot, trace }),
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(trace.named(ESpan.PodProvision)).toHaveLength(1)
    expect(calls).toHaveLength(0)
  })
})
