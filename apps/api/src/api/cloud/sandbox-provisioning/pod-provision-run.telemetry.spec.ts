import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { runPodProvision } from './pod-provision-run'
import { podTelemetryIdentity } from './pod-telemetry-identity'
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

describe('runPodProvision telemetry identity', () => {
  useTestDatabase()

  it('hands the pod a stable telemetry identity derived from the owner', async () => {
    await seedThread()
    await seedSandboxRow()
    const { boot, calls } = fakeBoot()

    await runPodProvision({
      payload: await payloadOf(),
      deps: runDepsWith({ boot, telemetryPepper: 'p' }),
    })

    expect(calls[0]?.environment).toEqual({
      [API_PROVISIONED_ENV]: '1',
      ATLAS_TELEMETRY_IDENTITY: podTelemetryIdentity({ userId: 'usr-1', pepper: 'p' }),
    })
  })

  it('provisions without a telemetry identity when no pepper is configured', async () => {
    await seedThread()
    await seedSandboxRow()
    const { boot, calls } = fakeBoot()

    await runPodProvision({ payload: await payloadOf(), deps: runDepsWith({ boot }) })

    expect(calls[0]?.environment).toEqual({ [API_PROVISIONED_ENV]: '1' })
  })
})
