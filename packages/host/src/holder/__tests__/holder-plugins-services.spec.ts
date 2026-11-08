import { describe, expect, it } from 'bun:test'

import { composeCommands } from '@dltech/atlas-commands'
import { createV2EventSchema, type V2Event } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { definePlugin, composePlugins } from '@dltech/atlas-plugin-sdk'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { servicesControl } from '@dltech/atlas-plugin-services/control'
import { servicesCoreSlots } from '@dltech/atlas-plugin-services/core'
import { servicesPod } from '@dltech/atlas-plugin-services/pod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const servicesPlugin = definePlugin({
  name: 'services',
  ...servicesCoreSlots,
  pod: servicesPod,
  control: servicesControl,
  client: servicesClient,
  transport: 'stream',
})

const servicesRig = async (script: ScriptedModelStep[]) => {
  const composed = composePlugins([servicesPlugin])
  const store = new InMemoryControlStore()
  const plane = new ControlPlane({
    store,
    eventSchema: createV2EventSchema({ pluginBodies: composed.eventBodies }),
    pluginViews: composed.views,
  })
  const rig = await makeRig({
    store,
    plane,
    script,
    plugins: composed,
    commands: composeCommands(composed.commands),
    commandHandlers: composed.pod.commands,
  })
  await seedSession(rig)
  await rig.holder.start()
  return rig
}

type Rig = Awaited<ReturnType<typeof servicesRig>>

const eventsOf = async (rig: Rig): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const has = (type: string) => async (rig: Rig) =>
  (await eventsOf(rig)).some((event) => event.type === type)

describe('a session that registers the services plugin', () => {
  it('starts a service, lists it, and records ready and the ending in the view', async () => {
    const script: ScriptedModelStep[] = [
      {
        calls: [
          {
            callId: 'c1',
            name: 'service_start',
            input: { description: 'web', command: 'listen', workdir: '/', port: 3000 },
          },
        ],
      },
      { calls: [{ callId: 'c2', name: 'service_list', input: {} }] },
      { text: 'started' },
    ]
    const rig = await servicesRig(script)
    await rig.post('start a service')
    await rig.wake()
    await flushUntil({ check: async () => has('service-ready')(rig) })

    const events = await eventsOf(rig)
    const started = events.find((event) => event.type === 'service-started')
    expect(started).toMatchObject({ command: 'listen', description: 'web', port: 3000 })
    const serviceId = started && 'serviceId' in started ? started.serviceId : ''
    expect(serviceId).toMatch(/^svc-[0-9a-f]{8}$/)
    expect(events.filter((event) => event.type === 'service-ready')).toMatchObject([{ serviceId }])
    await flushUntil({
      check: async () =>
        (await eventsOf(rig)).filter((event) => event.type === 'tool-result').length >= 2,
    })
    expect(JSON.stringify((await eventsOf(rig)).filter((e) => e.type === 'tool-result'))).toContain(
      'port 3000',
    )

    const view = await rig.plane.readSessionView({ sessionId: SESSION, threadId: THREAD_ID })
    expect(view.value.pluginViews.services).toMatchObject([
      { serviceId, status: 'running', ready: true, port: 3000, name: 'web' },
    ])

    script.push(
      { calls: [{ callId: 'c3', name: 'service_stop', input: { serviceId } }] },
      { text: 'stopped' },
    )
    await rig.post('stop it')
    await rig.wake()
    await flushUntil({ check: async () => has('service-ended')(rig) })

    expect((await eventsOf(rig)).filter((event) => event.type === 'service-ended')).toMatchObject([
      { serviceId, status: 'killed', killedBy: 'model' },
    ])
    const ended = await rig.plane.readSessionView({ sessionId: SESSION, threadId: THREAD_ID })
    expect(ended.value.pluginViews.services).toMatchObject([
      { serviceId, status: 'killed', ready: false },
    ])
  })
})
