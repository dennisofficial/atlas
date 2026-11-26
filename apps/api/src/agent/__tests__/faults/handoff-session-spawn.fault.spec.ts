import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect } from 'bun:test'

import { CALL_ID, dispatchesOf, interruptedOf, resultsOf } from './handoff-service-support'
import type { HostKnobs } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const GATE = join(tmpdir(), `atlas-spawn-gate-${RUN}`)

const KNOBS: HostKnobs = {
  plugins: true,
  pluginToolGate: { tool: 'spawn_session', waitFor: GATE, phase: 'after' },
}

const spawnedOf = async (ctx: HandoffContext) => {
  const roster = await ctx.rig.plane.sessionsOf({ sessionId: ctx.sessionId })
  return roster.sessions.filter((row) => row.spawnedBySessionId === ctx.sessionId)
}

type BriefPost = { message?: { clientId?: string | undefined; text?: string | undefined } }

const briefPostsOf = async (ctx: HandoffContext, threadId: string) => {
  const page = await ctx.rig.plane.readEvents({
    threadId,
    afterSeq: 0,
    limit: 200,
    visible: false,
  })
  return page.events
    .filter((row) => row.type === 'input-posted')
    .map((row) => row as unknown as BriefPost)
    .filter((post) => post.message?.clientId?.startsWith('spawn-brief:') === true)
}

const openGate = (): void => {
  writeFileSync(GATE, '')
}

describeHandoff({
  name: 'a spawned session whose host is killed after the spawn',
  prompt: 'spawn a peer session and tell me its id',
  drain: false,
  podRestart: 'survives',
  knobs: KNOBS,
  start: async (ctx) => {
    rmSync(GATE, { force: true })
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: KNOBS,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'spawn_session',
                input: { title: 'the peer', brief: 'read the port' },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the spawned session to exist',
      check: async () => (await spawnedOf(ctx)).length === 1,
    })
    return hostA
  },
  inFlight: async (ctx) => {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },
  release: async () => {
    openGate()
  },
  settled: async (ctx) => {
    await waitUntil({
      what: 'the spawn call to report its result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    const [result] = await resultsOf(ctx)
    expect(interruptedOf(result as { event: unknown })).toBe(false)
    const spawned = await spawnedOf(ctx)
    expect(spawned).toHaveLength(1)
    const peer = spawned[0]
    const output = (result?.event ?? {}) as { output?: { sessionId?: string } }
    expect(output.output?.sessionId).toBe(peer?.sessionId)
    expect(peer?.firstMessageText).toBe('read the port')
    const posts = await briefPostsOf(ctx, peer?.mainThreadId ?? '')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.message?.clientId).toBe(`spawn-brief:${peer?.sessionId ?? ''}`)
    expect(posts[0]?.message?.text).toContain('read the port')
  },
  runs: async (ctx) => (await spawnedOf(ctx)).length,
})
