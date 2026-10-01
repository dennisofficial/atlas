import { describe, expect, it } from 'bun:test'

import { ELogSeverity } from '@dltech/atlas-core'

import { liftToCloud } from '../lift'
import { useAtlasHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { CapturingLog } from './fake-log'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { fakeLiftAgents, harness } from './lift-fixture'

describe('lift operational log', () => {
  it('warns durably when the GPG capture fails instead of silently dropping signing', async () => {
    useAtlasHome()
    const log = new CapturingLog()
    const test = harness({
      captureGpg: async () => {
        throw new Error('gpg: no secret key')
      },
      logPort: log,
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    const entry = log.entries.find((one) => one.data?.['operation'] === 'capture-gpg')
    expect(entry?.severity).toBe(ELogSeverity.Warn)
    expect(entry?.source).toBe('cloud.lift')
    expect(entry?.threadId).toBe(CLOUD_THREAD)
    expect(entry?.error).toBe('gpg: no secret key')
    expect(entry?.stack).toContain('gpg: no secret key')
  })

  it('warns durably when the relocation notice never lands in the local log', async () => {
    useAtlasHome()
    const log = new CapturingLog()
    const test = harness({ logPort: log })
    test.localLog.append = async () => {
      throw new Error('disk full')
    }

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    const entry = log.entries.find((one) => one.data?.['operation'] === 'append-relocation-notice')
    expect(entry?.severity).toBe(ELogSeverity.Warn)
    expect(entry?.source).toBe('cloud.lift')
    expect(entry?.threadId).toBe(CLOUD_THREAD)
    expect(entry?.error).toBe('disk full')
  })

  it('refuses ownership and logs an error when serve cannot restore the transcript', async () => {
    useAtlasHome()
    const log = new CapturingLog()
    const test = harness({ bridge: fakeBridge({ restoreTranscriptRefused: true }), logPort: log })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    const entry = log.entries.find((one) => one.data?.['nodeId'] === 'restore')
    expect(entry?.severity).toBe(ELogSeverity.Error)
    expect(entry?.source).toBe('cloud.relocation')
    expect(entry?.threadId).toBe(CLOUD_THREAD)
    expect(entry?.data?.['phase']).toBe('pre-commit')
  })

  it('warns with the child id when a child flip notice never lands', async () => {
    useAtlasHome()
    const log = new CapturingLog()
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const test = harness({ agents: fakeLiftAgents([child]), logPort: log })
    test.localLog.append = async () => {
      throw new Error('child log locked')
    }

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    const entry = log.entries.find(
      (one) => one.data?.['operation'] === 'append-child-location-changed',
    )
    expect(entry?.severity).toBe(ELogSeverity.Warn)
    expect(entry?.source).toBe('cloud.lift')
    expect(entry?.threadId).toBe(CLOUD_THREAD)
    expect(entry?.data?.['childId']).toBe(child.agentId)
    expect(entry?.error).toBe('child log locked')
  })

  it('logs a failing DAG node as an error with its node and phase', async () => {
    useAtlasHome()
    const log = new CapturingLog()
    const test = harness({ bridge: fakeBridge({ putTranscriptFails: new Error('socket reset') }), logPort: log })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    const entry = log.entries.find((one) => one.source === 'cloud.relocation')
    expect(entry?.severity).toBe(ELogSeverity.Error)
    expect(entry?.threadId).toBe(CLOUD_THREAD)
    expect(entry?.data).toEqual({ nodeId: 'provision', phase: 'pre-commit' })
    expect(entry?.error).toBe('socket reset')
    expect(entry?.stack).toContain('socket reset')
  })
})
