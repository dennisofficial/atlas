import { afterEach, describe, expect, it } from 'bun:test'

import { cloudRuntimeParts } from '../cloud-app'
import { fakeApp, scriptedModelPort } from '../../__tests__/fake-app'
import {
  activeSubscriptionRegistry,
  publishSubscriptionRegistry,
} from '../subscription-registry-holder'
import { fakeBridge, CLOUD_THREAD, type FakeCloudChannel } from './fixture'

const attached = () => {
  const bridge = fakeBridge()
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  const { stores } = bridge.attach({
    threadId: CLOUD_THREAD,
    url: 'https://sandbox.example',
    token: 'tok',
  })
  const channel: FakeCloudChannel = bridge.channel
  return { app, channel, stores }
}

const countPushListeners = (channel: FakeCloudChannel) => {
  const live = { count: 0 }
  channel.onSubscriptions = () => {
    live.count += 1
    return () => void (live.count -= 1)
  }
  return live
}

describe('the subscription registry a cloud channel carries', () => {
  afterEach(() => publishSubscriptionRegistry(null))

  it('is one registry per channel, however many times the runtime parts are composed', () => {
    const { app, channel, stores } = attached()
    const live = countPushListeners(channel)

    cloudRuntimeParts({ channel, stores, runner: app.runner })
    const first = activeSubscriptionRegistry()
    cloudRuntimeParts({ channel, stores, runner: app.runner })

    expect(activeSubscriptionRegistry()).toBe(first)
    expect(live.count).toBe(1)
  })

  it('drops its channel listeners when another registry replaces it or none is published', () => {
    const { app, channel, stores } = attached()
    const live = countPushListeners(channel)
    cloudRuntimeParts({ channel, stores, runner: app.runner })

    publishSubscriptionRegistry(null)

    expect(live.count).toBe(0)
  })

  it('listens afresh when the same channel is composed again after release', () => {
    const { app, channel, stores } = attached()
    const live = countPushListeners(channel)
    cloudRuntimeParts({ channel, stores, runner: app.runner })
    publishSubscriptionRegistry(null)

    cloudRuntimeParts({ channel, stores, runner: app.runner })

    expect(live.count).toBe(1)
  })
})
