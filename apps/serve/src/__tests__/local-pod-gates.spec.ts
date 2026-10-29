import { describe, expect, it } from 'bun:test'
import { NoticePort, toThreadId, type NoticePost } from '@dltech/atlas-core'
import type { DeltaChannel } from '@dltech/atlas-harness'

import { hydrateWhenRegistered } from '../serve-hydrate'
import { threadModelPersisterOf } from '../serve-thread-model-persist'
import { bindServeWriteBehind } from '../serve-write-behind'

import type { ServeApp } from '../serve-app'

const threadId = toThreadId('thr_local_pod')
const cloud = { ATLAS_CLOUD_URL: 'https://api.example.com', ATLAS_SERVE_TOKEN: 't' }
const localPod = { ...cloud, ATLAS_POD_NAME: 'atlas-pod-1' }

const calls: string[] = []
const spyFetch = (async (input: string | URL | Request) => {
  calls.push(String(input))
  throw new Error('no API call expected')
}) as unknown as typeof fetch

class SilentNotice extends NoticePort {
  notify(_post: NoticePost): void {}
}

describe('local pod mirrors no thread state', () => {
  it('skips hydrate', async () => {
    const result = await hydrateWhenRegistered({
      env: localPod,
      atlasHome: '/nonexistent',
      threadId,
      controlPlaneUrl: 'https://api.example.com',
      token: 't',
      clientVersion: 'dev',
      fetchFn: spyFetch,
      log: () => undefined,
    })
    expect(result).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('has no model persister', () => {
    expect(
      threadModelPersisterOf({
        env: localPod,
        threadId,
        controlPlaneUrl: 'https://api.example.com',
        token: 't',
        clientVersion: 'dev',
        fetchFn: spyFetch,
        notice: new SilentNotice(),
      }),
    ).toBeUndefined()
    expect(
      threadModelPersisterOf({
        env: cloud,
        threadId,
        controlPlaneUrl: 'https://api.example.com',
        token: 't',
        clientVersion: 'dev',
        fetchFn: spyFetch,
        notice: new SilentNotice(),
      }),
    ).toBeDefined()
  })

  it('has no write-behind', () => {
    const bound = bindServeWriteBehind({
      env: localPod,
      app: {} as Pick<ServeApp, 'log' | 'rewind' | 'compaction'> & {
        threads: Pick<ServeApp['threads'], 'onRename'>
        channel: Pick<DeltaChannel, 'subscribe'>
      },
      threadId,
      durableHead: 0,
      remote: {
        controlPlaneUrl: 'https://api.example.com',
        token: 't',
        clientVersion: 'dev',
        fetchFn: spyFetch,
      },
      log: () => undefined,
    })
    expect(bound).toBeUndefined()
    expect(calls).toEqual([])
  })
})
