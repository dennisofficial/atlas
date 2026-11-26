import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SpawnFile } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'

import { startRig, type FaultRig, type HostKnobs, type HostProcess } from './fault-rig'
import { contextFor, freshWorkspaceOf, type HandoffContext } from './handoff-context'

export type { HandoffContext } from './handoff-context'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const waitUntil = async (args: {
  check: () => Promise<boolean>
  timeoutMs?: number
  what: string
}): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 30_000)
  while (Date.now() < deadline) {
    if (await args.check()) return
    await sleep(150)
  }
  throw new Error(`timed out waiting for ${args.what}`)
}

export type HandoffScenario = {
  name: string
  /** the operator message the session starts with */
  prompt?: string
  files?: readonly SpawnFile[] | undefined
  /** whether the clean drain case runs; a tool blocked inside the host never lets a drain finish */
  drain?: boolean
  /** whether the workspace is already prepared when the session starts (default true) */
  prepared?: boolean
  /** what the pod runs as the setup script; the work under test when the scenario is a setup */
  setupScript?: string
  /** host knobs both hosts get, so the handover runs the same configuration */
  knobs?: HostKnobs
  takeOverScripts?(args: { sessionId: string }): Record<string, ScriptedModelStep[]>
  /** begins the work on host A, and waits until it is really in flight */
  start(ctx: HandoffContext): Promise<HostProcess>
  /** runs once host B is up and before it claims: fault the pod link here so the takeover meets it down */
  beforeClaim?(ctx: HandoffContext, hostB: HostProcess): Promise<void>
  /** wakes a session that waits for the operator and wants no holder until then */
  wake?(ctx: HandoffContext): Promise<void>
  /** the record still says the work is in flight, after another host took the session over */
  inFlight(ctx: HandoffContext): Promise<void>
  /** lets the work finish */
  release(ctx: HandoffContext): Promise<void>
  /** the record shows the work finished, and only once */
  settled(ctx: HandoffContext): Promise<void>
  /** how many times the work ran */
  runs(ctx: HandoffContext): Promise<number>
  /** after the pod itself restarted: the work did not finish, and never ran again */
  interrupted?(ctx: HandoffContext): Promise<void>
}

/**
 * Proves that work which outlives a turn or a prepare — a background setup script, a bash call —
 * keeps running on the pod and is collected exactly once whichever host takes the session over:
 *
 * - host A drains cleanly mid-work;
 * - host A is SIGKILLed mid-work;
 * - the pod restarts mid-work: the call is gone, so the record says it was interrupted and the
 *   work is never run a second time (only when the scenario supplies `interrupted`).
 *
 * Every case starts its own rig, pod and workspace, because a setup script leaves markers in the
 * workspace that a later case must not inherit.
 */
export const describeHandoff = (scenario: HandoffScenario): void => {
  describe.skipIf(REDIS_URL === undefined)(`handoff: ${scenario.name}`, () => {
    const testDb = useTestDatabase()

    const fresh = async (args: {
      rig: FaultRig
      root: string
      slug: string
    }): Promise<HandoffContext> => {
      const workspace = freshWorkspaceOf({ root: args.root, slug: args.slug })
      const sessionId = `handoff-${args.slug}-${RUN}`
      const threadId = await args.rig.newSession({
        sessionId,
        text: scenario.prompt ?? 'do the work',
        prepared: scenario.prepared !== false,
        ...(scenario.files === undefined ? {} : { files: scenario.files }),
      })
      const daemon = await args.rig.spawnDaemonFor({ sessionId })
      return contextFor({
        rig: args.rig,
        sessionId,
        threadId,
        daemon,
        workspace,
      })
    }

    const takeOver = async (ctx: HandoffContext): Promise<HostProcess> => {
      await scenario.wake?.(ctx)
      const hostB = await ctx.rig.spawnHost({
        label: 'host-b',
        daemonUrl: ctx.daemon.url,
        workspace: ctx.workspace,
        scripts: scenario.takeOverScripts?.({ sessionId: ctx.sessionId }) ?? {
          [ctx.sessionId]: [{ text: 'host b finished' }],
        },
        ...(scenario.setupScript === undefined ? {} : { setupScript: scenario.setupScript }),
        ...(scenario.knobs === undefined ? {} : { knobs: scenario.knobs }),
      })
      await scenario.beforeClaim?.(ctx, hostB)
      await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-b', timeoutMs: 30_000 })
      return hostB
    }

    const withRig = async <T>(work: (rig: FaultRig, root: string) => Promise<T>): Promise<T> => {
      const root = mkdtempSync(join(tmpdir(), `atlas-handoff-${RUN}-`))
      const rig = await startRig({
        databaseUrl: testDb().url,
        redisUrl: REDIS_URL ?? '',
        ...(scenario.setupScript === undefined ? {} : { setupScript: scenario.setupScript }),
      })
      try {
        return await work(rig, root)
      } finally {
        await rig.stop()
        rmSync(root, { recursive: true, force: true })
      }
    }

    const collectOnce = async (ctx: HandoffContext): Promise<void> => {
      await scenario.inFlight(ctx)
      await scenario.release(ctx)
      await scenario.settled(ctx)
      expect(await scenario.runs(ctx)).toBe(1)
    }

    const ownFault = async (args: {
      slug: string
      apply(ctx: HandoffContext, hostA: HostProcess): Promise<void>
    }): Promise<void> =>
      withRig(async (rig, root) => {
        const ctx = await fresh({ rig, root, slug: args.slug })
        const hostA = await scenario.start(ctx)
        await args.apply(ctx, hostA)
        const hostB = await takeOver(ctx)
        try {
          await collectOnce(ctx)
        } catch (error: unknown) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
          )
        }
      })

    it.skipIf(scenario.drain === false)(
      'survives host A draining cleanly mid-work',
      async () => {
        await ownFault({
          slug: 'drain',
          apply: async (_ctx, hostA) => {
            hostA.kill('SIGTERM')
            await hostA.exited
          },
        })
      },
      90_000,
    )

    it('survives host A being SIGKILLed mid-work', async () => {
      await ownFault({
        slug: 'sigkill',
        apply: async (_ctx, hostA) => {
          hostA.kill('SIGKILL')
          await hostA.exited
        },
      })
    }, 90_000)

    it.skipIf(scenario.interrupted === undefined)(
      'reports the work interrupted, and never reruns it, when the pod restarts mid-work',
      async () =>
        withRig(async (rig, root) => {
          const ctx = await fresh({ rig, root, slug: 'restart' })
          const hostA = await scenario.start(ctx)
          hostA.kill('SIGKILL')
          await hostA.exited
          await ctx.daemon.restart({ keepHome: true })
          const hostB = await takeOver(ctx)
          try {
            // give the new holder time to re-join the call and find it gone from the pod
            await sleep(1_000)
            if (scenario.interrupted !== undefined) await scenario.interrupted(ctx)
            expect(await scenario.runs(ctx)).toBe(1)
          } catch (error: unknown) {
            throw new Error(
              `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
            )
          }
        }),
      90_000,
    )
  })
}
