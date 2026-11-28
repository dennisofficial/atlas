import { expect } from 'bun:test'

import { EShellEndCause } from '@dltech/atlas-core'
import { liveFrameSchema } from '@dltech/atlas-protocol'

import { createRedisLiveSource } from '../../bus/redis-live-source'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { callIdOf } from './fault-support'

const PROMPT = 'SHELL-PUBLISHER-PARENT start a background shell and an observer'
const BRIEF = 'SHELL-PUBLISHER-CHILD wait for the child gate'
const BEFORE = 'publisher-before-child-exit'
const AFTER = 'publisher-after-child-exit'

const rowsOf = async (ctx: HandoffContext) => await ctx.record()

const endedRows = async (ctx: HandoffContext) =>
  (await rowsOf(ctx)).filter((row) => row.type === 'background-shell-ended')

const publishedText = async (ctx: HandoffContext): Promise<string> => {
  const url = process.env.ATLAS_TEST_REDIS_URL
  if (url === undefined) throw new Error('the fault suite needs Redis')
  const source = createRedisLiveSource({ url })
  try {
    return (await source.readShellBacklog(ctx.sessionId))
      .map((raw) => {
        const frame = liveFrameSchema.parse(JSON.parse(raw))
        return frame.type === 'shell-output' ? frame.text : ''
      })
      .join('')
  } finally {
    await source.close()
  }
}

const expectPublishedOnce = async (args: { ctx: HandoffContext; text: string }): Promise<void> => {
  await waitUntil({
    what: args.text,
    check: async () => (await publishedText(args.ctx)).includes(args.text),
  })
  expect((await publishedText(args.ctx)).split(args.text)).toHaveLength(2)
}

describeHandoff({
  name: 'one shell publisher shared with an observer child that exits before handoff',
  prompt: PROMPT,
  knobs: { plugins: true },

  async start(ctx) {
    const publish = ctx.gate('publish')
    const child = ctx.gate('child')
    const after = ctx.gate('after')
    const gate = ctx.gate('gate')
    const command = [
      `cat ${publish}`,
      `echo ${BEFORE}`,
      `echo run >> ${ctx.path('runs')}`,
      `touch ${ctx.path('started')}`,
      `cat ${after}`,
      `echo ${AFTER}`,
      `cat ${gate}`,
      'echo done',
    ].join('; ')
    const host = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { plugins: true },
      scripts: {
        [`${ctx.sessionId}#${PROMPT}@host-a`]: [
          {
            calls: [
              {
                callId: 'spawn',
                name: 'agent_spawn',
                input: { agentType: 'general-purpose', intent: 'observe the shell', brief: BRIEF },
              },
            ],
          },
          {
            calls: [
              {
                callId: 'shell',
                name: 'bash',
                input: { description: 'publish once', command, background: true },
              },
            ],
          },
          { text: 'the shell runs in the background' },
        ],
        [`${ctx.sessionId}#${BRIEF}@host-a`]: [
          {
            calls: [
              {
                callId: 'observe',
                name: 'bash',
                input: { description: 'wait as an observer', command: `cat ${child}` },
              },
            ],
          },
          { text: 'the observer is done' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the observer to start its foreground call',
      check: async () => {
        const spawned = (await rowsOf(ctx)).find((row) => row.type === 'agent-spawned')
        const agentId = (spawned?.event as { agentId?: string } | undefined)?.agentId
        if (agentId === undefined) return false
        const page = await ctx.rig.plane.readEvents({
          threadId: agentId,
          afterSeq: 0,
          limit: 100,
          visible: false,
        })
        return page.events.some((event) => event.type === 'tool-dispatched')
      },
    })
    await ctx.release('publish')
    await ctx.waitFor('started', 30_000)
    await expectPublishedOnce({ ctx, text: BEFORE })
    await ctx.release('child')
    await waitUntil({
      what: 'the observer child to exit',
      check: async () => (await rowsOf(ctx)).some((row) => row.type === 'agent-ended'),
    })
    await ctx.release('after')
    await expectPublishedOnce({ ctx, text: AFTER })
    await waitUntil({
      what: 'the main turn to end while the shell keeps running',
      check: async () => (await rowsOf(ctx)).some((row) => row.type === 'turn-ended'),
    })
    return host
  },

  async inFlight(ctx) {
    expect(await endedRows(ctx)).toHaveLength(0)
    expect(ctx.runCount('runs')).toBe(1)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the shell to end exactly once after handoff',
      check: async () => (await endedRows(ctx)).length === 1,
    })
    expect(await endedRows(ctx)).toHaveLength(1)
    expect(
      (await rowsOf(ctx)).filter(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'shell',
      ),
    ).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the restarted pod to end the old shell once',
      check: async () => (await endedRows(ctx)).length === 1,
    })
    expect((await endedRows(ctx))[0]?.event).toMatchObject({ cause: EShellEndCause.PodRestarted })
  },
})
