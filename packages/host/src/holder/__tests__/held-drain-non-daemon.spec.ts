import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  ToolDefinition,
  type RecordEvent,
  type ThreadId,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { EExecOutcome } from '@dltech/atlas-protocol'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { createInMemoryDaemon, fakeDaemonGroups } from '@dltech/atlas-protocol/testing'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { DRAIN_IN_FLIGHT_CAP_MS, DRAIN_STREAM_ABORT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession, SANDBOX, SECRET, THREAD_ID } from './holder-rig'

const LIST_PROBE = 'worktree_probe'

type Held = { started: number; release(): void }

class WorktreeProbe extends ToolDefinition {
  readonly name = LIST_PROBE
  readonly description = 'list the worktrees of the project directory'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.object({})

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    try {
      const listing = await this.ctx.worktrees.list({ cwd: args.projectDirectory })
      return { ok: true, output: listing, modelText: listing.repository }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
}

const probePlugin = (): Plugin =>
  definePlugin({
    name: 'worktree-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      tools: (ctx) => [new WorktreeProbe(ctx)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const heldExecGroup =
  (held: Held): DaemonGroupFactory =>
  () => ({
    name: 'exec',
    ops: [
      defineOp({
        op: 'exec',
        run: async ({ ctx }) => {
          held.started += 1
          await new Promise<void>((resolve) => {
            held.release = resolve
            ctx.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          return { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 0 }
        },
      }),
    ],
  })

const daemonOf = (held: Held) =>
  createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: (args) => [
      ...fakeDaemonGroups(args).filter((factory) => factory({ publish: () => {} }).name !== 'exec'),
      heldExecGroup(held),
    ],
  })

const eventsIn = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  threadId: ThreadId
}): Promise<RecordEvent[]> =>
  (
    await args.rig.plane.readEvents({
      threadId: args.threadId,
      afterSeq: 0,
      limit: 1_000,
      visible: false,
    })
  ).events

const resultsOf = (events: readonly RecordEvent[]): RecordEvent[] =>
  events.filter((event) => event.type === 'tool-result')

describe('draining while a plugin tool waits on a capability call', () => {
  it('writes no record row for the call it leaves unresolved', async () => {
    const held: Held = { started: 0, release: () => {} }
    const rig = await makeRig({
      daemon: await daemonOf(held),
      plugins: composePlugins([probePlugin()]),
      model: () =>
        new ScriptedModel([
          { calls: [{ callId: 'w1', name: LIST_PROBE, input: {} }] },
          { text: 'done' },
        ]),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('list the worktrees')
    await rig.wake()
    expect(await flushUntil({ check: () => held.started > 0, clock: rig.clock })).toBe(true)

    const draining = rig.holder.drain()
    await rig.flush()
    rig.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await rig.flush()
    rig.clock.advance(DRAIN_STREAM_ABORT_CAP_MS)
    await draining

    held.release()
    await rig.flush()

    expect(resultsOf(await eventsIn({ rig, threadId: THREAD_ID }))).toEqual([])
  }, 20_000)
})
