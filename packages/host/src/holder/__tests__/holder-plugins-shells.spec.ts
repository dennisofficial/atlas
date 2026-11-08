import { describe, expect, it } from 'bun:test'

import { composeCommands } from '@dltech/atlas-commands'
import { createV2EventSchema, type V2Event } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { definePlugin, composePlugins } from '@dltech/atlas-plugin-sdk'
import { shellsClient } from '@dltech/atlas-plugin-shells/client'
import { shellsControl } from '@dltech/atlas-plugin-shells/control'
import { shellsCoreSlots } from '@dltech/atlas-plugin-shells/core'
import { shellsPod } from '@dltech/atlas-plugin-shells/pod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const shellsPlugin = definePlugin({
  name: 'shells',
  ...shellsCoreSlots,
  pod: shellsPod,
  control: shellsControl,
  client: shellsClient,
  transport: 'stream',
})

const shellsRig = async (script: ScriptedModelStep[]) => {
  const composed = composePlugins([shellsPlugin])
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

type Rig = Awaited<ReturnType<typeof shellsRig>>

const eventsOf = async (rig: Rig): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const has = (type: string) => async (rig: Rig) =>
  (await eventsOf(rig)).some((event) => event.type === type)

describe('a session that registers the shells plugin', () => {
  it('starts a shell, reads it, kills it, and records the ending in the view', async () => {
    const script: ScriptedModelStep[] = [
      {
        calls: [
          {
            callId: 'c1',
            name: 'shell',
            input: { command: 'echo tick; sleep 30', description: 'ticker' },
          },
        ],
      },
      { text: 'started' },
    ]
    const rig = await shellsRig(script)
    await rig.post('start a shell')
    await rig.wake()
    await flushUntil({ check: async () => has('background-shell-started')(rig) })

    const started = (await eventsOf(rig)).find((event) => event.type === 'background-shell-started')
    expect(started).toMatchObject({ command: 'echo tick; sleep 30', description: 'ticker' })
    const shellId = started && 'shellId' in started ? started.shellId : ''
    expect(shellId).toMatch(/^shell-[0-9a-f]{8}$/)
    expect(started && 'cwd' in started ? started.cwd : undefined).toBeString()

    script.push(
      { calls: [{ callId: 'c2', name: 'shell_output', input: { shellId } }] },
      { calls: [{ callId: 'c3', name: 'shell_kill', input: { shellId } }] },
      { text: 'stopped' },
    )
    await flushUntil({
      check: async () =>
        (await eventsOf(rig)).filter((event) => event.type === 'tool-result').length >= 1,
    })
    await rig.post('read it and stop it')
    await rig.wake()
    await flushUntil({ check: async () => has('background-shell-ended')(rig) })

    const events = await eventsOf(rig)
    const results = events.filter((event) => event.type === 'tool-result')
    expect(JSON.stringify(results)).toContain('tick')
    expect(events.filter((event) => event.type === 'background-shell-ended')).toMatchObject([
      { shellId, status: 'killed' },
    ])

    const view = await rig.plane.readSessionView({ sessionId: SESSION, threadId: THREAD_ID })
    expect(view.value.pluginViews.shells).toMatchObject([
      { shellId, status: 'killed', awaitingInput: false, name: '"ticker" (`echo tick; sleep 30`)' },
    ])
  })
})
