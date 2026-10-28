import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EPodState } from '@dltech/atlas-wire'

import { createApiPodBridge } from '../api-pod-bridge'
import { EConnectionView } from '../connection-view'
import { createFakePodApi, statusOf } from './api-pod-fixture'
import { createFakeTimerClock } from './fake-timer-clock'

const THREAD = toThreadId('thr_attach')
const PARENT = toThreadId('thr_parent')

const until = async (check: () => boolean): Promise<void> => {
  const deadline = Date.now() + 1000
  while (!check() && Date.now() < deadline) await Bun.sleep(5)
}

const attached = (fake: ReturnType<typeof createFakePodApi>, sandboxThreadId?: typeof THREAD) => {
  const bridge = createApiPodBridge({ api: fake.api, clock: createFakeTimerClock().clock })
  return bridge.attach({
    threadId: THREAD,
    ...(sandboxThreadId === undefined ? {} : { sandboxThreadId }),
  })
}

describe('attach', () => {
  it('starts parked when no url or token is given', () => {
    const attachment = attached(createFakePodApi())

    expect(attachment.channel.connection().state).toBe(EConnectionView.Parked)
    attachment.channel.close()
  })

  it('mints a fresh ticket on every wake rather than reusing the first', async () => {
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.Running)] })
    const attachment = attached(fake)

    attachment.channel.reconnect()
    await until(() => fake.tickets.length >= 1)
    attachment.channel.close()
    const second = attached(fake)
    second.channel.reconnect()
    await until(() => fake.tickets.length >= 2)
    second.channel.close()

    expect(fake.tickets).toEqual(['ticket-1', 'ticket-2'])
    expect(attachment.channel.attachment()?.token).toBe('ticket-1')
  })

  it('provisions a parked pod and waits before it connects on wake', async () => {
    const fake = createFakePodApi({
      statuses: [statusOf(EPodState.Parked), statusOf(EPodState.Running)],
    })
    const attachment = attached(fake)

    attachment.channel.reconnect()
    await until(() => fake.tickets.length === 1)
    attachment.channel.close()

    expect(fake.calls).toEqual([
      `status:${THREAD}`,
      `provision:${THREAD}`,
      `status:${THREAD}`,
      `connect:${THREAD}`,
    ])
  })

  it('wakes the thread that hosts the sandbox when a successor attaches', async () => {
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.Running)] })
    const attachment = attached(fake, PARENT)

    attachment.channel.reconnect()
    await until(() => fake.tickets.length === 1)
    attachment.channel.close()

    expect(fake.calls).toEqual([`status:${PARENT}`, `connect:${PARENT}`])
  })

  it('surfaces a failed wake on the channel as a disconnect', async () => {
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.Running)] })
    fake.failConnectWith(new Error('pod-not-running'))
    const attachment = attached(fake)

    attachment.channel.reconnect()
    await until(() => attachment.channel.connection().state === EConnectionView.Disconnected)
    const view = attachment.channel.connection()
    attachment.channel.close()

    expect(view.state).toBe(EConnectionView.Disconnected)
    expect(view.detail).toContain('pod-not-running')
  })

  it('hands back remote stores over the channel', () => {
    const attachment = attached(createFakePodApi())

    expect(Object.keys(attachment.stores).sort()).toEqual(['ledger', 'log', 'threads'])
    attachment.channel.close()
  })
})
