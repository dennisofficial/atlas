import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
import type { DependencyContainer } from '../../container/injection'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { createTempDatabaseUrl } from '../../store/__tests__/harness'
import { ToolDispatcher, type DispatchableCall } from '../../tools/dispatch'
import { composeHarness } from '../compose'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices } from './fakes'

let project: string
let atlasHome: string
let database: ReturnType<typeof createTempDatabaseUrl>
let previousAtlasHome: string | undefined

const PLUGIN_SOURCE = `
import { definePlugin, EHookPhase, EStage, EBeforeToolDecision } from 'atlas'

export default definePlugin({
  id: 'repo-guard',
  register: (host) => {
    if (typeof host.log.append !== 'function') throw new Error('host.log was not wired')

    return {
      hooks: [
        {
          phase: EHookPhase.BeforeTool,
          name: 'deny-everything',
          order: { stage: EStage.Guard, nudge: 0 },
          run: async () => ({ decision: EBeforeToolDecision.Deny, reason: 'repo-guard denied it' }),
        },
      ],
    }
  },
})
`

beforeEach(async () => {
  project = await realpath(await mkdtemp(join(tmpdir(), 'atlas-plugin-parity-repo-project-')))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-plugin-parity-repo-home-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
  database = createTempDatabaseUrl()

  const pluginsDirectory = join(project, '.atlas', 'plugins')
  await mkdir(pluginsDirectory, { recursive: true })
  await writeFile(join(pluginsDirectory, 'index.ts'), PLUGIN_SOURCE)
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
    user: new MemorySettingsStore({ label: 'plugin-parity repo-plugins spec' }),
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

describe('serve gets the same repo plugins the TUI gets, because composeHarness assembles them after stores bind', () => {
  it('lets a project plugin whose register(host) touches host.log guard a tool call, rather than being refused', async () => {
    const notices = recordingNotices()
    let container: DependencyContainer | undefined

    const app = await composeHarness<undefined, never>({
      launch: { cwd: project, command: 'atlas-serve', model: undefined, executionLocation: undefined },
      env: {},
      settings: settingsBinding(),
      clientVersion: 'plugin-parity-repo-plugins-spec',
      surface: {
        notice: notices.port,
        bind: (args) => {
          container = args.container
          return undefined
        },
      },
    })

    if (container === undefined) throw new Error('surface.bind never ran')

    const refusal = notices.posts.find((notice) => notice.text.toLowerCase().includes('refused'))
    expect(refusal).toBeUndefined()

    const drafts = await dispatchWrite({ container, path: join(project, 'notes.md') })

    expect(drafts.some((draft) => draft.type === 'tool-denied')).toBe(true)

    await app.close()
  })
})
