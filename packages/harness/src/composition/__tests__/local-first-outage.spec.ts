import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  EFinishReason,
  ModelPort,
  toAccountId,
  type AssistantPart,
  type CredentialPort,
  type ModelStepResult,
} from '@dltech/atlas-core'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../../cloud/settings-definitions'
import type { DependencyContainer } from '../../container/injection'
import { fileAccountStore } from '../../credentials/account-store'
import { atlasCloudFile, atlasVaultFile, atlasVaultKeyFile } from '../../credentials/paths'
import { ETurnStatus } from '../../loop/turn-outcome'
import { createAnthropicOauthModel } from '../../providers/anthropic-oauth'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { SystemClock } from '../../store/clock'
import { composeHarness } from '../compose'
import type { HarnessApp } from '../harness-app'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices } from './fakes'
import {
  CLOUD_URL,
  PROVIDER_URL,
  ScriptedLocalModel,
  outageFetch,
  registerModel,
  requests,
  silentHostSources,
  type RecordedRequest,
} from './local-first-outage-fakes'

let project: string
let atlasHome: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'atlas-outage-project-'))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-outage-home-'))
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
    definitions: [
      ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
      ...CLOUD_SETTING_DEFINITIONS,
    ],
    user: new MemorySettingsStore({ label: 'local-first outage spec' }),
  }),
  bindTo: () => {},
})

const seedLocalAccounts = async (): Promise<void> => {
  await fileAccountStore({
    file: atlasVaultFile(),
    keyFile: atlasVaultKeyFile(),
    clock: new SystemClock(),
  }).add({
    provider: EAuthProvider.Anthropic,
    label: 'spec claude plan',
    origin: EAccountOrigin.Login,
    secret: {
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    },
  })
}

const seedCloudSession = (): void => {
  new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() }).write({
    url: CLOUD_URL,
    token: 'fake-session-token',
    email: null,
  })
}

const cloudRequests = (): RecordedRequest[] =>
  requests.filter((request) => request.url.startsWith(CLOUD_URL))

const textOf = (parts: readonly AssistantPart[]): string =>
  parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')

const compose = async (args: {
  bind?: (args: { container: DependencyContainer }) => void
  model?: ScriptedLocalModel
}): Promise<HarnessApp<undefined, never>> =>
  composeHarness<undefined, never>({
    launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
    env: {},
    settings: settingsBinding(),
    clientVersion: 'local-first-outage-spec',
    surface: { notice: recordingNotices().port },
    bindPorts: (bindArgs) => {
      silentHostSources({
        container: bindArgs.container,
        codexFile: join(atlasHome, 'no-codex-auth.json'),
      })
      if (args.model !== undefined) {
        registerModel({ container: bindArgs.container, model: args.model })
      }
      args.bind?.(bindArgs)
    },
  })

describe('a composed local session while Atlas Cloud is down', () => {
  it('boots signed-in, runs a fresh turn on the local vault, and never calls the cloud', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = outageFetch('reject')

    try {
      await seedLocalAccounts()
      seedCloudSession()

      const model = new ScriptedLocalModel({ script: [{ text: 'local answer one' }] })
      const app = await compose({ model })
      expect(app.workspace.workspace).toBe(await realpath(project))
      expect(await app.accounts.list()).toHaveLength(1)
      expect(app.cloud.session()).not.toBeNull()

      const thread = await app.threads.create({})
      const outcome = await app.runner.say({ threadId: thread.id, text: 'say anything' })
      expect(outcome.status).toBe(ETurnStatus.Completed)

      const events = await app.log.read({ threadId: thread.id })
      const reply = events.filter((event) => event.type === 'assistant-said').at(-1)
      expect(textOf(reply?.type === 'assistant-said' ? reply.parts : [])).toContain(
        'local answer one',
      )

      // Nothing reaches the cloud on a local-first boot.
      expect(cloudRequests()).toEqual([])
      expect(requests.some((request) => request.url.includes('/v1/accounts'))).toBe(false)
      expect(requests.some((request) => request.url.includes('/v1/mcp'))).toBe(false)

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
      requests.length = 0
    }
  })

  it('resumes a second turn on the same thread while the cloud answers 503', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = outageFetch('503')

    try {
      await seedLocalAccounts()
      seedCloudSession()

      const model = new ScriptedLocalModel({ script: [{ text: 'first answer' }, { text: 'second answer' }] })
      const app = await compose({ model })

      const thread = await app.threads.create({})
      const first = await app.runner.say({ threadId: thread.id, text: 'first' })
      expect(first.status).toBe(ETurnStatus.Completed)

      const second = await app.runner.say({ threadId: thread.id, text: 'second' })
      expect(second.status).toBe(ETurnStatus.Completed)

      const events = await app.log.read({ threadId: thread.id })
      const replies = events
        .filter((event) => event.type === 'assistant-said')
        .map((event) => textOf(event.type === 'assistant-said' ? event.parts : []))
      expect(replies).toEqual(['first answer', 'second answer'])

      expect(cloudRequests()).toEqual([])

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
      requests.length = 0
    }
  })

  it('hands the provider only the fake endpoint and the seeded OAuth token, never the cloud', async () => {
    const realFetch = globalThis.fetch
    const providerCalls: RecordedRequest[] = []
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const record = { url, authorization: headers.get('authorization') ?? undefined }
      requests.push(record)
      if (url.startsWith(PROVIDER_URL)) {
        providerCalls.push(record)
        throw new Error('no real inference in a spec')
      }
      throw new Error('offline')
    }) as unknown as typeof fetch

    try {
      await seedLocalAccounts()
      seedCloudSession()

      const credentials: CredentialPort = {
        read: async () => ({
          kind: EAuthKind.Oauth,
          accountId: toAccountId('acc_local'),
          accessToken: 'fake-access-token',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
        discard: async () => {},
      }
      const providerModel = createAnthropicOauthModel({
        credentials,
        modelId: 'claude-haiku-4-5-20251001',
        baseURL: PROVIDER_URL,
      })
      const probe = new (class extends ModelPort {
        readonly identity = { id: 'anthropic', modelId: 'oauth-probe' }
        async step(): Promise<ModelStepResult> {
          await Promise.resolve(providerModel.doStream({ prompt: [] } as never)).catch(
            () => undefined,
          )
          return {
            parts: [{ type: 'text', text: 'probe done' }],
            toolCalls: [],
            finishReason: EFinishReason.Stop,
          }
        }
      })()
      const app = await compose({
        bind: ({ container }) => registerModel({ container, model: probe }),
      })

      const thread = await app.threads.create({})
      await app.runner.say({ threadId: thread.id, text: 'ping' })

      expect(providerCalls.length).toBeGreaterThan(0)
      expect(providerCalls.every((call) => call.url.startsWith(PROVIDER_URL))).toBe(true)
      expect(providerCalls.every((call) => call.authorization?.includes('fake-access-token'))).toBe(
        true,
      )
      expect(cloudRequests()).toEqual([])

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
      requests.length = 0
    }
  })

  it('a hung coordination read never blocks a local turn', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input)
      requests.push({ url, authorization: undefined })
      if (url.startsWith(CLOUD_URL)) return new Promise<Response>(() => {})
      throw new Error('offline')
    }) as unknown as typeof fetch

    try {
      await seedLocalAccounts()
      seedCloudSession()

      const model = new ScriptedLocalModel({ script: [{ text: 'still local' }] })
      const app = await compose({ model })

      const thread = await app.threads.create({})
      const outcome = await app.runner.say({ threadId: thread.id, text: 'go' })

      expect(outcome.status).toBe(ETurnStatus.Completed)

      const events = await app.log.read({ threadId: thread.id })
      const reply = events.filter((event) => event.type === 'assistant-said').at(-1)
      expect(textOf(reply?.type === 'assistant-said' ? reply.parts : [])).toContain('still local')

      await expect(app.close()).resolves.toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
      requests.length = 0
    }
  }, 30_000)
})
