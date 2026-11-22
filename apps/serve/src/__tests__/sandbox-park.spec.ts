import { describe, expect, it } from 'bun:test'

import { POD_NAME_ENV } from '@dltech/atlas-harness'
import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'
import { toThreadId } from '@dltech/atlas-core'

import { podPark, providerStopFor, sandboxPark, type SignalSender } from '../sandbox-park'

const threadId = toThreadId('pod-park-owner')
const controlPlaneUrl = 'https://control-plane.invalid'
const token = 'serve-token'

const API_PROVISIONED = {
  [API_PROVISIONED_ENV]: '1',
  ATLAS_SANDBOX_SESSION_ID: 'session',
}

function recordingSender() {
  const calls: Array<{ pid: number; signal: NodeJS.Signals }> = []
  const sendSignal: SignalSender = (call) => {
    calls.push(call)
  }
  return { calls, sendSignal }
}

describe('podPark', () => {
  it('is undefined without ATLAS_POD_NAME', () => {
    expect(podPark({ env: {} })).toBeUndefined()
  })

  it('is undefined when ATLAS_POD_NAME is empty', () => {
    expect(podPark({ env: { [POD_NAME_ENV]: '' } })).toBeUndefined()
  })
})

describe('providerStopFor', () => {
  it('sends SIGTERM to pid 1 only when the pod stop is invoked', async () => {
    const { calls, sendSignal } = recordingSender()
    const stop = providerStopFor({
      threadId,
      controlPlaneUrl,
      token,
      env: { [POD_NAME_ENV]: 'pod-a' },
      sendSignal,
    })

    expect(calls).toEqual([])
    await stop()
    expect(calls).toEqual([{ pid: 1, signal: 'SIGTERM' }])
  })

  it('rejects without a sandbox or pod and never signals', async () => {
    const { calls, sendSignal } = recordingSender()
    const stop = providerStopFor({ threadId, controlPlaneUrl, token, env: {}, sendSignal })

    await expect(stop()).rejects.toThrow('this runtime has no sandbox to stop')
    expect(calls).toEqual([])
  })

  it('prefers the api-provisioned stop over the pod stop when both envs are present', async () => {
    const { calls, sendSignal } = recordingSender()
    const env = { ...API_PROVISIONED, [POD_NAME_ENV]: 'pod-a' }
    let vercelStops = 0
    const sandboxStopFor: typeof sandboxPark = (args) =>
      sandboxPark(args) === undefined
        ? undefined
        : async () => {
            vercelStops += 1
          }

    await providerStopFor({ threadId, controlPlaneUrl, token, env, sendSignal, sandboxStopFor })()

    expect(vercelStops).toBe(1)
    expect(calls).toEqual([])
  })

  it('ignores a legacy Vercel env and falls through to the pod stop', async () => {
    const { calls, sendSignal } = recordingSender()
    const env = {
      VERCEL_TOKEN: 'token',
      VERCEL_TEAM_ID: 'team',
      VERCEL_PROJECT_ID: 'project',
      ATLAS_SANDBOX_SESSION_ID: 'session',
      [POD_NAME_ENV]: 'pod-a',
    }

    await providerStopFor({ threadId, controlPlaneUrl, token, env, sendSignal })()

    expect(calls).toEqual([{ pid: 1, signal: 'SIGTERM' }])
  })
})
