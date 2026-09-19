import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  ESettingId,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { portToken } from '../../container/injection'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { createTempDatabaseUrl } from '../../store/__tests__/harness'
import { ToolDispatcher, type DispatchableCall } from '../../tools/dispatch'
import { composeHarness } from '../compose'
import type { DependencyContainer } from '../../container/injection'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices } from './fakes'

let project: string
let atlasHome: string
let database: ReturnType<typeof createTempDatabaseUrl>
let previousAtlasHome: string | undefined

beforeEach(async () => {
  project = await realpath(await mkdtemp(join(tmpdir(), 'atlas-plugin-parity-project-')))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-plugin-parity-home-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
  database = createTempDatabaseUrl()
})

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  database.discard()
  await rm(project, { recursive: true, force: true })
  await rm(atlasHome, { recursive: true, force: true })
})

const settingsBinding = (): SettingsBinding => {
  const service = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ label: 'plugin-parity spec' }),
  })
  service.set({ id: ESettingId.DatabaseUrl, value: database.databaseUrl })
  return { service, bindTo: () => {} }
}

const dispatchWrite = (args: { container: DependencyContainer; path: string }): Promise<readonly EventDraft[]> => {
  const dispatcher = args.container.resolve(portToken(ToolDispatcher))
  const call: DispatchableCall = {
    callId: toCallId('call-1'),
    name: 'write',
    input: { path: args.path, content: 'x' },
    runId: toRunId('run-1'),
    threadId: toThreadId('thread-1'),
  }

  return dispatcher.dispatch({
    call,
    signal: new AbortController().signal,
    projectDirectory: project,
    events: [],
  })
}

describe('serve gets the same plugins the TUI gets, because composeHarness loads them itself', () => {
  it('denies a write into a sibling worktree through the foreign-checkout native plugin', async () => {
    let container: DependencyContainer | undefined
    const app = await composeHarness<undefined, never>({
      launch: { cwd: project, command: 'atlas-serve', model: undefined, executionLocation: undefined },
      env: {},
      settings: settingsBinding(),
      clientVersion: 'plugin-parity-spec',
      surface: {
        notice: recordingNotices().port,
        bind: (args) => {
          container = args.container
          return undefined
        },
      },
    })

    if (container === undefined) throw new Error('surface.bind never ran')

    const drafts = await dispatchWrite({
      container,
      path: join(project, '.atlas', 'worktrees', 'other', 'file.ts'),
    })

    expect(drafts.some((draft) => draft.type === 'tool-denied')).toBe(true)

    await app.close()
  })

  it('allows an ordinary write inside the project directory', async () => {
    let container: DependencyContainer | undefined
    const app = await composeHarness<undefined, never>({
      launch: { cwd: project, command: 'atlas-serve', model: undefined, executionLocation: undefined },
      env: {},
      settings: settingsBinding(),
      clientVersion: 'plugin-parity-spec',
      surface: {
        notice: recordingNotices().port,
        bind: (args) => {
          container = args.container
          return undefined
        },
      },
    })

    if (container === undefined) throw new Error('surface.bind never ran')

    const drafts = await dispatchWrite({ container, path: join(project, 'notes.md') })

    expect(drafts.some((draft) => draft.type === 'tool-denied')).toBe(false)

    await app.close()
  })
})
