import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { ESandboxProvisionState } from '@dltech/atlas-wire'

import type { ChannelConnection } from '../../cloud/remote-delta-channel'
import { EConnectionView } from '../../cloud/connection-view'
import type { PodProvisionProbe } from '../pod-session'
import { createPodSession } from '../pod-session'
import { fakeSessionChannel, type FakeSessionChannel } from './fake-session-channel'
import { recordingNotices, type RecordingNotices } from './pod-fakes'

const THREAD = toThreadId('thr_send')

const PARKED: ChannelConnection = { state: EConnectionView.Parked, detail: null }

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

type Rig = {
  channel: FakeSessionChannel
  notices: RecordingNotices
  sends: { threadId: string; sendId: string; text: string }[]
  wakes: () => number
  provisions: () => number
  send: (text: string) => void
}

const sessionOn = (args: {
  connection?: ChannelConnection | undefined
  api?: PodProvisionProbe | undefined
  sendFails?: unknown
}): Rig => {
  const channel = fakeSessionChannel({ connection: args.connection ?? PARKED })
  const notices = recordingNotices()
  const sends: Rig['sends'] = []
  let wakes = 0
  let provisions = 0
  const probe = args.api
  const api: PodProvisionProbe | undefined =
    probe === undefined
      ? undefined
      : {
          threadSandbox: {
            provision: {
              mutate: async () => {
                provisions += 1
                return probe.threadSandbox.provision.mutate({ threadId: THREAD })
              },
            },
          },
        }
  const session = createPodSession({
    channel,
    sandboxes: { find: async () => undefined },
    messages: {
      send: async (message) => {
        if (args.sendFails !== undefined) throw args.sendFails
        sends.push({ threadId: message.threadId, sendId: message.sendId, text: message.text })
      },
    },
    ...(api === undefined ? {} : { api }),
    wake: async () => {
      wakes += 1
    },
    notice: notices,
    onReload: async () => undefined,
  })
  return {
    channel,
    notices,
    sends,
    wakes: () => wakes,
    provisions: () => provisions,
    send: (text) => session.send({ text }),
  }
}

const apiProvisioned: PodProvisionProbe = {
  threadSandbox: { provision: { mutate: async () => ({ state: ESandboxProvisionState.Booting }) } },
}

const byoPod: PodProvisionProbe = {
  threadSandbox: {
    provision: { mutate: async () => ({ state: ESandboxProvisionState.NotConfigured }) },
  },
}

describe('a parked-pod send', () => {
  it('records the intent through the API lane, then attaches for feedback', async () => {
    const rig = sessionOn({ api: apiProvisioned })

    rig.send('do this when you wake')
    await tick()

    expect(rig.sends.map((send) => send.text)).toEqual(['do this when you wake'])
    expect(rig.sends[0]?.threadId).toBe(rig.channel.threadId)
    expect(rig.wakes()).toBe(1)
    expect(rig.notices.posted).toEqual([])
  })

  it('keeps the wake-only ceremony when the pod is not API provisioned', async () => {
    const rig = sessionOn({ api: byoPod })

    rig.send('hello a bring-your-own pod')
    await tick()

    expect(rig.sends).toEqual([])
    expect(rig.wakes()).toBe(1)
  })

  it('never touches the API lane without a control-plane probe', async () => {
    const rig = sessionOn({})

    rig.send('fully local pod')
    await tick()

    expect(rig.sends).toEqual([])
    expect(rig.wakes()).toBe(1)
    expect(rig.provisions()).toBe(0)
  })

  it('answers an API refusal with a notice, not a wake', async () => {
    const rig = sessionOn({ api: apiProvisioned, sendFails: new Error('conflict') })

    rig.send('this one 409s')
    await tick()

    expect(rig.sends).toEqual([])
    expect(rig.wakes()).toBe(0)
    expect(rig.notices.posted.some((post) => post.text.includes('could not be queued'))).toBe(true)
  })

  it('does not wake for a send recorded while already connected', async () => {
    const rig = sessionOn({
      connection: { state: EConnectionView.Connected, detail: null },
      api: apiProvisioned,
    })

    rig.send('mid-session')
    await tick()

    expect(rig.sends).toHaveLength(1)
    expect(rig.wakes()).toBe(0)
  })
})
