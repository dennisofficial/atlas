import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import {
  API_PROVISIONED_ENV,
  bootStepOfWire,
  EBootStep,
  EBootStepState,
  NOOP_BOOT_REPORTER,
  type BootStepEvent,
} from '@dltech/atlas-wire'

import { EWorkspaceState, EWorkspaceStep, type EnsureWorkspace } from '../materialize-workspace'
import { startServe } from '../index'
import { bootServeFiles } from '../serve-boot'
import { bootReporterFor } from '../serve-boot-reporter'

import { fakeServeApp } from './fakes'

const threadId = toThreadId('thread-boot-report')
const controlPlaneUrl = 'https://api.example.com'
const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const recordingFetch = () => {
  const events: BootStepEvent[] = []
  const requests: { url: string; authorization: string | null }[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (!url.endsWith(`/v1/threads/${threadId}/events`)) return new Response('{}', { status: 404 })
    const headers = new Headers(init?.headers)
    requests.push({ url, authorization: headers.get('authorization') })
    const parsed: { drafts: { type: string; body: string }[] } = JSON.parse(String(init?.body))
    for (const draft of parsed.drafts) {
      const event = bootStepOfWire(draft)
      if (event !== null) events.push(event)
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { fetchFn, events, requests }
}

const boot = async (args: {
  env: Record<string, string | undefined>
  ensureWorkspace?: EnsureWorkspace
}) => {
  const atlasHome = mkdtempSync(join(tmpdir(), 'atlas-boot-report-'))
  homes.push(atlasHome)
  const recorded = recordingFetch()
  const reporter = bootReporterFor({
    env: args.env,
    controlPlaneUrl,
    threadId,
    token: 'serve-token',
    clientVersion: 'dev',
    fetchFn: recorded.fetchFn,
    log: () => undefined,
  })
  await bootServeFiles({
    env: args.env,
    threadId,
    cwd: atlasHome,
    atlasHome,
    log: () => undefined,
    ensureWorkspace: args.ensureWorkspace ?? (async () => ({ state: EWorkspaceState.Skipped })),
    controlPlaneUrl,
    token: 'serve-token',
    clientVersion: 'dev',
    fetchFn: recorded.fetchFn,
    reporter,
  })
  await reporter.track({ step: EBootStep.Agent, work: async () => undefined })
  return recorded
}

const indexOf = (events: BootStepEvent[], step: EBootStep, state: EBootStepState): number =>
  events.findIndex((event) => event.step === step && event.state === state)

describe('serve boot reporting', () => {
  it('reports Running before Done for Clone, Context, Settings and Agent, with Agent last', async () => {
    const { events, requests } = await boot({ env: { [API_PROVISIONED_ENV]: '1' } })

    for (const step of [EBootStep.Clone, EBootStep.Context, EBootStep.Settings, EBootStep.Agent]) {
      const running = indexOf(events, step, EBootStepState.Running)
      const done = indexOf(events, step, EBootStepState.Done)
      expect(running).toBeGreaterThanOrEqual(0)
      expect(done).toBeGreaterThan(running)
    }
    expect(events.at(-1)).toEqual({ step: EBootStep.Agent, state: EBootStepState.Done })
    expect(indexOf(events, EBootStep.Agent, EBootStepState.Running)).toBeGreaterThan(
      Math.max(
        indexOf(events, EBootStep.Clone, EBootStepState.Done),
        indexOf(events, EBootStep.Context, EBootStepState.Done),
        indexOf(events, EBootStep.Settings, EBootStepState.Done),
      ),
    )
    expect(requests.every((request) => request.authorization === 'Bearer serve-token')).toBe(true)
  })

  it('emits nothing when the sandbox was not provisioned by the API', async () => {
    const { events, requests } = await boot({ env: {} })

    expect(events).toEqual([])
    expect(requests).toEqual([])
  })

  it('reports Clone as errored with the reason and keeps booting', async () => {
    const { events } = await boot({
      env: { [API_PROVISIONED_ENV]: '1' },
      ensureWorkspace: async () => ({
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'repository not found',
      }),
    })

    expect(events).toContainEqual({
      step: EBootStep.Clone,
      state: EBootStepState.Error,
      error: 'repository not found',
    })
    expect(indexOf(events, EBootStep.Clone, EBootStepState.Done)).toBe(-1)
    expect(indexOf(events, EBootStep.Settings, EBootStepState.Done)).toBeGreaterThanOrEqual(0)
  })

  it('uses the noop reporter outside API provisioning', () => {
    const reporter = bootReporterFor({
      env: {},
      controlPlaneUrl,
      threadId,
      token: 't',
      clientVersion: 'dev',
      fetchFn: fetch,
      log: () => undefined,
    })

    expect(reporter).toBe(NOOP_BOOT_REPORTER)
  })
})

describe('startServe boot reporting', () => {
  it('reports every boot step through the real boot path when api-provisioned', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-boot-report-start-'))
    homes.push(home)
    const previous = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    const { fetchFn, events } = recordingFetch()
    try {
      const handle = await startServe({
        threadId,
        port: 0,
        token: 'serve-token',
        controlPlaneUrl,
        env: { [API_PROVISIONED_ENV]: '1' },
        cwd: '/workspace',
        write: () => undefined,
        compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
        ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
        fetchFn,
      })
      await handle.close()
    } finally {
      if (previous === undefined) delete process.env.ATLAS_HOME
      else process.env.ATLAS_HOME = previous
    }

    expect(events.map((event) => `${event.step}:${event.state}`)).toEqual([
      'clone:running',
      'clone:done',
      'settings:running',
      'settings:done',
      'context:running',
      'context:done',
      'agent:running',
      'agent:done',
    ])
  })
})
