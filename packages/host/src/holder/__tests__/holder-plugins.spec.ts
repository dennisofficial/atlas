import { describe, expect, it } from 'bun:test'

import { composeCommands } from '@dltech/atlas-commands'
import { createV2EventSchema, type V2Event } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { composePlugins } from '@dltech/atlas-plugin-sdk'
import {
  createFixturePlugin,
  PROBE_LABELS_VIEW,
  PROBE_TOOL,
  probeObserve,
} from '@dltech/atlas-plugin-sdk/testing'

import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { createInMemoryDaemon, type InMemoryDaemon } from '@dltech/atlas-protocol/testing'

import { flushUntil, makeRig, SANDBOX, SECRET, seedSession, SESSION, THREAD_ID } from './holder-rig'

const SET = { repoPath: '/w', head: 'a', branches: [], worktrees: [] }

const publishingGitGroup: DaemonGroupFactory = () => ({
  name: 'git',
  ops: [
    defineOp({
      op: 'git.watch',
      run: async ({ ctx }) => {
        ctx.publish({ type: 'git.branches', set: SET })
        return SET
      },
    }),
  ],
})

const pluginRig = async (
  script: Parameters<typeof makeRig>[0]['script'],
  daemon?: InMemoryDaemon,
) => {
  const { plugin, record } = createFixturePlugin()
  const composed = composePlugins([plugin])
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
    daemon,
    plugins: composed,
    commands: composeCommands(composed.commands),
    commandHandlers: composed.pod.commands,
  })
  await seedSession(rig)
  await rig.holder.start()
  return { rig, record, composed }
}

const eventsOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

describe('a session that registers plugins', () => {
  it('runs a plugin tool, fires its hook and records what the tool appended', async () => {
    const { rig, record } = await pluginRig([
      { calls: [{ callId: 'c1', name: PROBE_TOOL, input: { label: 'from-tool' } }] },
      { text: 'done' },
    ])
    await rig.post('go')
    await rig.wake()
    await flushUntil({
      check: async () => (await eventsOf(rig)).some((e) => e.type === 'probe-observed'),
    })

    const events = await eventsOf(rig)
    expect(events.filter((e) => e.type === 'probe-observed')).toMatchObject([
      { label: 'from-tool' },
    ])
    expect(events.some((e) => e.type === 'tool-result')).toBe(true)
    expect(record.beforeStep).toBeGreaterThan(0)
    const model = rig.runtimes[0]?.model
    expect(model).toBeInstanceOf(ScriptedModel)
    const declared =
      model instanceof ScriptedModel ? model.requests[0]?.tools.map((tool) => tool.name) : undefined
    expect(declared).toContain(PROBE_TOOL)
    const view = await rig.plane.readSessionView({ sessionId: SESSION, threadId: THREAD_ID })
    expect(view.value.pluginViews[PROBE_LABELS_VIEW]).toEqual(['from-tool'])
  })

  it('runs a plugin pod command through the inbox', async () => {
    const { rig } = await pluginRig([{ text: 'unused' }])
    await rig.plane.post({
      sessionId: SESSION,
      kind: probeObserve.inboxKind,
      payload: JSON.stringify({ label: 'from-command' }),
    })
    await rig.wake()
    await flushUntil({
      check: async () => (await eventsOf(rig)).some((e) => e.type === 'probe-observed'),
    })
    expect((await eventsOf(rig)).filter((e) => e.type === 'probe-observed')).toMatchObject([
      { label: 'from-command' },
    ])
  })

  it('delivers a daemon frame to the slot handler and to a hook listener', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
      groups: () => [publishingGitGroup],
    })
    const { rig, record } = await pluginRig([{ text: 'ok' }], daemon)
    await rig.post('go')
    await rig.wake()
    await flushUntil({ check: () => rig.runtimes.length > 0 && record.beforeStep > 0 })
    await rig.runtimes[0]?.remoteCalls.invoke({
      key: 'watch-1',
      op: { op: 'git.watch', repoPath: '/w' },
    })
    await flushUntil({ check: () => record.daemonFrames.length > 0 })
    expect(record.daemonFrames.map((f) => f.event.type)).toEqual(['git.branches'])
    expect(record.listenerFrames.map((f) => f.event.type)).toEqual(['git.branches'])
    await daemon.stop()
  })
})
