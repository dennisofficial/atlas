import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  toRunId,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'

import { portToken } from '../../container/injection'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { composeHarness } from '../compose'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { RandomIds } from '../../store/ids'
import { SystemClock } from '../../store/clock'
import { registryFor } from '../../store/sessions/registry'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices } from './fakes'

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

const restoreLinked = async (args: { threadId: ThreadId }): Promise<void> => {
  const log = new JsonlEventLog(
    atlasHome,
    registryFor({ home: atlasHome }),
    new SystemClock(),
    new RandomIds(),
  )
  await log.append({
    threadId: args.threadId,
    runId: toRunId('run_restored'),
    drafts: [
      {
        type: 'pull-request-linked',
        number: 42,
        url: 'https://github.com/dennisofficial/atlas/pull/42',
        repo: 'github.com/dennisofficial/atlas',
        branch: 'dennis/linked-branch',
      },
    ],
  })
}

describe('projection seeding from the restored log', () => {
  it('folds the named thread’s restored log into plugin projections before any surface runs', async () => {
    const threadId = toThreadId('br_restored')
    await restoreLinked({ threadId })

    const app = await composeHarness<undefined, never>({
      launch: {
        cwd: project,
        command: 'atlas-test',
        model: undefined,
        executionLocation: undefined,
        threadId,
      },
      env: {},
      settings: settingsBinding(),
      clientVersion: 'seed-spec',
      surface: { notice: recordingNotices().port },
    })

    const links = app.pluginProjections.find((entry) => entry.projection.id === 'pull-requests')
    expect(links?.projection.current()).toEqual([
      {
        number: 42,
        url: 'https://github.com/dennisofficial/atlas/pull/42',
        repo: 'github.com/dennisofficial/atlas',
        branch: 'dennis/linked-branch',
      },
    ])

    await app.close()
  })

  it('leaves projections empty for a launch that names no thread', async () => {
    const app = await composeHarness<undefined, never>({
      launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
      env: {},
      settings: settingsBinding(),
      clientVersion: 'seed-spec',
      surface: { notice: recordingNotices().port },
    })

    const links = app.pluginProjections.find((entry) => entry.projection.id === 'pull-requests')
    expect(links?.projection.current()).toEqual([])

    await app.close()
  })

  it('boots anyway when the named thread has no readable log', async () => {
    const app = await composeHarness<undefined, never>({
      launch: {
        cwd: project,
        command: 'atlas-test',
        model: undefined,
        executionLocation: undefined,
        threadId: toThreadId('br_nothing-there'),
      },
      env: {},
      settings: settingsBinding(),
      clientVersion: 'seed-spec',
      surface: { notice: recordingNotices().port },
    })

    const links = app.pluginProjections.find((entry) => entry.projection.id === 'pull-requests')
    expect(links?.projection.current()).toEqual([])

    await app.close()
  })
})
