import { describe, expect, it } from 'bun:test'

import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

import { restartService, stopService } from '../service-actions'

const recordingApi = (calls: SessionCommandInput[]) => ({
  command: (input: SessionCommandInput): Promise<SessionCommandOutput> => {
    calls.push(input)
    return Promise.resolve({ inboxId: 7 })
  },
})

describe('stopService', () => {
  it('posts the stop action for the service id', async () => {
    const calls: SessionCommandInput[] = []

    await stopService({ api: recordingApi(calls), sessionId: 's1', serviceId: 'svc-1' })

    expect(calls).toEqual([
      { sessionId: 's1', name: 'service', args: { action: 'stop', serviceId: 'svc-1' } },
    ])
  })
})

describe('restartService', () => {
  it('posts the restart action for the service id', async () => {
    const calls: SessionCommandInput[] = []

    await restartService({ api: recordingApi(calls), sessionId: 's1', serviceId: 'svc-1' })

    expect(calls).toEqual([
      { sessionId: 's1', name: 'service', args: { action: 'restart', serviceId: 'svc-1' } },
    ])
  })
})
