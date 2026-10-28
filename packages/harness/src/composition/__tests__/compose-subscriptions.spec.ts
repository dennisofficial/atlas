import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  ESubscriptionActor,
  toRunId,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'

import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { composeHarness } from '../compose'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { RandomIds } from '../../store/ids'
import { SystemClock } from '../../store/clock'
import { registryFor } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices, testPortBindings } from './fakes'

let project: string
let atlasHome: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'atlas-seed-project-'))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-seed-home-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(project, { recursive: true, force: true })
  await rm(atlasHome, { recursive: true, force: true })
})

const settingsBinding = (): SettingsBinding => ({
  service: createSettingsService({
    definitions: [...ATLAS_SETTINGS],
    user: new MemorySettingsStore({ label: 'seed spec' }),
  }),
  bindTo: () => undefined,
})

const openStore = () => {
  const registry = registryFor({ home: atlasHome })
  const clock = new SystemClock()
  const ids = new RandomIds()
  const log = new JsonlEventLog(atlasHome, registry, clock, ids)
  return { log, threads: new JsonlThreadStore(atlasHome, registry, clock, ids, log) }
}

const restoreSubscribed = async (args: { threadId: ThreadId }): Promise<void> => {
  const { log } = openStore()
  await log.append({
    threadId: args.threadId,
    runId: toRunId('run_restored'),
    drafts: [
      {
        type: 'subscription-created',
        subscriptionId: 'sub_restored',
        provider: 'fake.pr',
        target: { input: 'a/b#1' },
        label: 'fake a/b#1',
        createdBy: ESubscriptionActor.Agent,
      },
    ],
  })
}

const composeFor = (threadId: ThreadId | undefined) =>
  composeHarness<undefined, never>({
    launch: {
      cwd: project,
      command: 'atlas-test',
      model: undefined,
      executionLocation: undefined,
      ...(threadId === undefined ? {} : { threadId }),
    },
    env: {},
    settings: settingsBinding(),
    ports: testPortBindings(),
    clientVersion: 'subscriptions-spec',
    surface: { notice: recordingNotices().port },
  })

const listed = async (args: {
  app: Awaited<ReturnType<typeof composeFor>>
  threadId: ThreadId
}): Promise<string> => {
  const tool = args.app.tools.find('subscription_list')
  const outcome = await tool?.invoke({
    input: {},
    signal: new AbortController().signal,
    idempotencyKey: 'key',
    projectDirectory: project,
    threadId: args.threadId,
    activeWorktree: undefined,
  })
  return outcome?.ok === true ? outcome.modelText : 'no result'
}

describe('subscription registry composition', () => {
  it('loads the launch thread’s subscriptions at compose time and serves them to the list tool', async () => {
    const threadId = toThreadId('br_subscribed')
    await restoreSubscribed({ threadId })
    const app = await composeFor(threadId)

    expect(await listed({ app, threadId })).toContain('sub_restored  fake.pr  fake a/b#1  active')
    await app.close()
  })

  it('loads a teammate’s subscriptions at compose time without any thread being opened', async () => {
    const { threads } = openStore()
    const main = await threads.create({ title: 'main', workspace: project })
    const teammate = await threads.create({
      workspace: project,
      agent: { spawnedBy: main.id, type: 'teammate' },
    })
    await restoreSubscribed({ threadId: teammate.id })
    const app = await composeFor(main.id)

    expect(await listed({ app, threadId: teammate.id })).toContain(
      'sub_restored  fake.pr  fake a/b#1  active',
    )
    await app.close()
  })

  it('composes with no subscriptions for a launch that names no thread', async () => {
    const app = await composeFor(undefined)
    expect(await listed({ app, threadId: toThreadId('br_fresh') })).toContain(
      'This conversation has no subscriptions.',
    )
    await app.close()
  })
})
