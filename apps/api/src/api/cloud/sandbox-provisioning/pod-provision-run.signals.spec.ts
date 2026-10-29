import { EThreadStreamFrame } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { failPodProvision, runPodProvision } from './pod-provision-run'
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

describe('runPodProvision signals', () => {
  useTestDatabase()

  it('signals a pod change once the sandbox is marked running', async () => {
    await seedThread()
    await seedSandboxRow()
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await runPodProvision({
      payload: await payloadOf(),
      deps: runDepsWith({ boot: fakeBoot().boot, signals }),
    })

    expect(frames).toContainEqual({ type: EThreadStreamFrame.Pod })
  })

  it('signals a pod change when provisioning fails', async () => {
    await seedThread()
    await seedSandboxRow()
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')
    const { boot } = fakeBoot({ failWith: new Error('vercel down') })

    await runPodProvision({ payload: await payloadOf(), deps: runDepsWith({ boot, signals }) })

    expect(frames).toContainEqual({ type: EThreadStreamFrame.Pod })
  })

  it('signals nothing when the claim was superseded', async () => {
    await seedThread()
    await seedSandboxRow()
    const payload = await payloadOf()
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      wakeClaim: new Date(Date.parse(payload.wakeClaim) + 5_000),
    })
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await runPodProvision({
      payload,
      deps: runDepsWith({ boot: fakeBoot().boot, signals }),
    })

    expect(frames).toEqual([])
  })

  it('failPodProvision signals a pod change', async () => {
    await seedThread()
    await seedSandboxRow()
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await failPodProvision({ payload: await payloadOf(), signals })

    expect(frames).toEqual([{ type: EThreadStreamFrame.Pod }])
  })
})
