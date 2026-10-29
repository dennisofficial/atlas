import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ERunner, EExecutionLocation } from '@dltech/atlas-core'

import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { composeHarness } from '../compose'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import { RandomIds } from '../../store/ids'
import { SystemClock } from '../../store/clock'
import { registryFor } from '../../store/sessions/registry'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices, testPortBindings } from './fakes'

let project: string
let atlasHome: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'atlas-runner-project-'))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-runner-home-'))
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
    user: new MemorySettingsStore({ label: 'runner spec' }),
  }),
  bindTo: () => undefined,
})

const bornOnPod = async () => {
  const registry = registryFor({ home: atlasHome })
  const clock = new SystemClock()
  const ids = new RandomIds()
  const log = new JsonlEventLog(atlasHome, registry, clock, ids)
  const threads = new JsonlThreadStore(atlasHome, registry, clock, ids, log)
  const thread = await threads.create({ executionLocation: EExecutionLocation.Cloud })
  await threads.chooseRunner({ threadId: thread.id, runner: ERunner.Local })
  return thread.id
}

describe('a launch that names its thread', () => {
  it('knows the runner that thread was born on before the first turn', async () => {
    const threadId = await bornOnPod()

    const app = await composeHarness<undefined, never>({
      launch: {
        cwd: project,
        command: 'atlas-test',
        model: undefined,
        executionLocation: 'cloud',
        threadId,
      },
      env: {},
      settings: settingsBinding(),
      ports: testPortBindings(),
      clientVersion: 'runner-spec',
      surface: { notice: recordingNotices().port },
    })

    expect(app.executionLocation.currentRunner()).toBe(ERunner.Local)

    await app.close()
  })
})
