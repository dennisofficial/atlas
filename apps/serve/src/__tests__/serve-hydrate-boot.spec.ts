import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-harness'
import {
  API_PROVISIONED_ENV,
  bootStepsPostSchema,
  EBootStep,
  EBootStepState,
  type BootStepEvent,
} from '@dltech/atlas-wire'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { fakeServeApp } from './fakes'
import { trpcFailure, trpcOk, trpcQueryUrl, trpcUrl } from './trpc-fake'
import { inMemoryContextFiles } from './serve-spec-fixture'
import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-hydrate-boot')
const controlPlaneUrl = 'https://api.example.com'
const homes: string[] = []
const running: ServeHandle[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const userSaid = (seq: number, text: string): WireEvent => ({
  id: `pg-${seq}`,
  threadId,
  seq,
  runId: 'run-web',
  depth: 0,
  at: '2026-10-22T00:00:00.000Z',
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text, requestId: 'send-1' }),
})

const boot = async (args: {
  env: Record<string, string | undefined>
  eventsReply: () => Response
  bootStepsReply?: (steps: BootStepEvent[]) => Response
}) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-hydrate-boot-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const steps: BootStepEvent[] = []
  const eventReads: string[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === trpcUrl({ controlPlaneUrl, procedure: 'sandboxSelf.bootSteps' })) {
      const posted = bootStepsPostSchema.parse(JSON.parse(String(init?.body))).steps
      steps.push(...posted)
      return args.bootStepsReply?.(posted) ?? trpcOk(undefined)
    }
    if (url.startsWith(trpcUrl({ controlPlaneUrl, procedure: 'threadEvents.read' }))) {
      eventReads.push(url)
      return args.eventsReply()
    }
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  const store = scratchTranscriptStore({ prefix: 'boot', home })
  let composed = 0
  const start = () =>
    startServe({
      threadId,
      port: 0,
      token: 'serve-token',
      controlPlaneUrl,
      env: args.env,
      cwd: '/workspace',
      write: () => undefined,
      compose: async () => {
        composed += 1
        return fakeServeApp({ threadId, root: '/workspace', intake: true, log: store.log })
      },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      contextFiles: inMemoryContextFiles(),
      fetchFn,
    })
  return { start, steps, eventReads, store, composed: () => composed }
}

const eventually = async (check: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the condition never held')
}

describe('serve boot hydration and resume', () => {
  it('hydrates a lone user-said and resumes it into a turn when api-provisioned', async () => {
    const run = await boot({
      env: { [API_PROVISIONED_ENV]: '1' },
      eventsReply: () => trpcOk([userSaid(1, 'first message')]),
    })

    running.push(await run.start())

    await eventually(async () =>
      (await run.store.log.read({ threadId })).some((event) => event.type === 'assistant-said'),
    )
    const events = await run.store.log.read({ threadId })
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'user-said'],
      [2, 'assistant-said'],
    ])
    expect(run.eventReads).toEqual([
      trpcQueryUrl({
        controlPlaneUrl,
        procedure: 'threadEvents.read',
        input: { threadId, own: true },
      }),
    ])
  })

  it('neither hydrates nor resumes a sandbox the API did not provision', async () => {
    const run = await boot({
      env: {},
      eventsReply: () => trpcOk([userSaid(1, 'first message')]),
    })

    running.push(await run.start())
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(run.eventReads).toEqual([])
    expect(await run.store.log.read({ threadId })).toEqual([])
  })

  it('fails the Agent boot step and never composes when hydration fails', async () => {
    const run = await boot({
      env: { [API_PROVISIONED_ENV]: '1' },
      eventsReply: () => trpcFailure({ status: 403, message: 'forbidden' }),
    })

    await expect(run.start()).rejects.toThrow()

    expect(run.composed()).toBe(0)
    const agent = run.steps.filter((step) => step.step === EBootStep.Agent)
    expect(agent.map((step) => step.state)).toEqual([EBootStepState.Running, EBootStepState.Error])
  })

  it('never imports events and rejects when the Agent Running post is refused', async () => {
    const run = await boot({
      env: { [API_PROVISIONED_ENV]: '1' },
      eventsReply: () => trpcOk([userSaid(1, 'first message')]),
      bootStepsReply: (posted) =>
        posted.some(
          (step) => step.step === EBootStep.Agent && step.state === EBootStepState.Running,
        )
          ? trpcFailure({ status: 500, message: 'boom' })
          : trpcOk(undefined),
    })

    await expect(run.start()).rejects.toThrow('500')

    expect(await run.store.log.read({ threadId })).toEqual([])
    expect(run.composed()).toBe(0)
  })

  it('keeps every other boot step best-effort when the API refuses them', async () => {
    const run = await boot({
      env: { [API_PROVISIONED_ENV]: '1' },
      eventsReply: () => trpcOk([]),
      bootStepsReply: (posted) =>
        posted.some(
          (step) => step.step === EBootStep.Agent && step.state === EBootStepState.Running,
        )
          ? trpcOk(undefined)
          : trpcFailure({ status: 500, message: 'boom' }),
    })

    running.push(await run.start())

    expect(run.eventReads).toHaveLength(1)
    expect(run.composed()).toBe(1)
  })

  it('posts Agent Running before it reads events', async () => {
    const order: string[] = []
    const run = await boot({
      env: { [API_PROVISIONED_ENV]: '1' },
      eventsReply: () => {
        order.push('events')
        return trpcOk([])
      },
      bootStepsReply: (posted) => {
        for (const step of posted) order.push(`${step.step}:${step.state}`)
        return trpcOk(undefined)
      },
    })

    running.push(await run.start())

    expect(order.indexOf('agent:running')).toBeGreaterThan(-1)
    expect(order.indexOf('agent:running')).toBeLessThan(order.indexOf('events'))
  })
})
