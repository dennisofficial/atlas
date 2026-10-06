import { describe, expect, it } from 'bun:test'
import {
  ATLAS_SETTINGS,
  catalogOf,
  EConsultation,
  EEffort,
  EImageTier,
  ESettingId,
  ETldrStatus,
  EUtilityModelRole,
  findCard,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type ModelCard,
} from '@dltech/atlas-core'
import { HaikuJudge } from '../../classifier/judge'
import { apiKeyCredential, oauthCredential } from '../../credentials/testing'
import { summaryFor } from '../../model/summariser'
import { titleFor } from '../../model/titler'
import { tldrFor } from '../../model/tldr'
import { OpenAiAdapter } from '../../providers/openai-adapter'
import { OpenRouterAdapter } from '../../providers/openrouter-adapter'
import { recordingFetch } from '../../providers/__tests__/recording-fetch'
import { streamedResponse } from '../../providers/__tests__/responses-stream-fixtures'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { recordingNotices } from './fakes'
import { createUtilityModel } from '../utility-model'

const card = (ref: ModelCard['ref']): ModelCard => ({
  ref,
  label: ref.modelId,
  api: 'openai-responses',
  contextWindow: 200_000,
  imageTier: EImageTier.Standard,
})
const PRIMARY = card({ providerId: 'openrouter', modelId: 'google/gemini-flash' })
const SESSION = card({ providerId: 'openai', modelId: 'gpt-session' })
const CATALOG = catalogOf([PRIMARY, SESSION])
const EVENTS = stampDrafts({
  drafts: [{ type: 'user-said', text: 'Fix the utility model fallback.' }],
  envelopes: [
    {
      id: toEventId('event'),
      seq: 1,
      threadId: toThreadId('thread'),
      runId: toRunId('run'),
      depth: 0,
      at: '2026-10-06T00:00:00.000Z',
    },
  ],
})
const ANSWERS: Record<EUtilityModelRole, string> = {
  [EUtilityModelRole.Titler]: '{"name":"Fix utility fallback"}',
  [EUtilityModelRole.Tldr]: '{"status":"done","summary":"Fixed utility fallback."}',
  [EUtilityModelRole.Judge]: '<verdict>proceed</verdict>',
  [EUtilityModelRole.Compaction]: 'You fixed utility fallback.',
}

describe('utility fallback across real provider transports', () => {
  it.each(Object.values(EUtilityModelRole))(
    'survives an OpenRouter credit wall for %s',
    async (role) => {
      let primaryCalls = 0
      const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => {
          primaryCalls++
          return Response.json(
            { error: { message: 'Insufficient credits', code: 402 } },
            { status: 402 },
          )
        },
      })
      try {
        const recorder = recordingFetch({ body: streamedResponse(ANSWERS[role]) })
        const credentials = {
          read: async () =>
            oauthCredential({ accessToken: 'stub-token', providerAccountId: 'stub-account' }),
          discard: async () => {},
        }
        const primary = new OpenRouterAdapter({
          credentials: {
            read: async () => apiKeyCredential({ apiKey: 'stub-openrouter' }),
            discard: async () => {},
          },
          cards: [PRIMARY],
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
        })
        const session = new OpenAiAdapter({ credentials, cards: [SESSION], fetch: recorder.fetch })
        const notices = recordingNotices()
        const model = createUtilityModel({
          role,
          notice: notices.port,
          settings: createSettingsService({
            definitions: ATLAS_SETTINGS,
            user: new MemorySettingsStore({
              document: {
                values: {
                  [ESettingId.QuickModel]: 'openrouter/google/gemini-flash',
                  [ESettingId.CompactionModel]: 'openrouter/google/gemini-flash',
                },
              },
            }),
          }),
          catalogue: {
            providers: [
              { id: primary.id, label: primary.label, cards: [PRIMARY] },
              { id: session.id, label: session.label, cards: [SESSION] },
            ],
            catalog: CATALOG,
            cardFor: (ref) => findCard({ catalog: CATALOG, ref }),
            adapterFor: (providerId) => (providerId === primary.id ? primary : session),
            reachable: () => true,
            subscribed: () => true,
            observeAccounts: () => {},
            subscribe: () => () => {},
            version: () => 0,
          },
          fallback: () => session.model({ card: SESSION, effort: () => EEffort.High }),
        })

        switch (role) {
          case EUtilityModelRole.Titler:
            expect(await titleFor({ model, text: 'Fix utility model fallback.' })).toBe(
              'Fix utility fallback',
            )
            break
          case EUtilityModelRole.Compaction:
            expect(await summaryFor({ model, events: EVENTS, fromSeq: 1, throughSeq: 1 })).toBe(
              ANSWERS[role],
            )
            break
          case EUtilityModelRole.Tldr:
            expect(await tldrFor({ model, events: EVENTS, anchorSeq: 1, throughSeq: 1 })).toEqual({
              text: 'Fixed utility fallback.',
              status: ETldrStatus.Done,
            })
            break
          case EUtilityModelRole.Judge: {
            const result = await new HaikuJudge({ model }).consult({
              brief: { system: 'judge the call', prompt: 'read a file', targets: [] },
              signal: new AbortController().signal,
            })
            expect(result.kind).toBe(EConsultation.Judged)
            expect(
              result.kind === EConsultation.Judged ? result.fault : 'unreachable',
            ).toBeUndefined()
            break
          }
        }
        expect(primaryCalls).toBe(1)
        expect(recorder.requests).toHaveLength(1)
        expect(recorder.requests[0]?.body).toMatchObject({ stream: true, store: false })
        expect(notices.posts.map((post) => post.key)).toEqual([
          `utility-model:${role}:openrouter`,
          `utility-model:${role}:fallback`,
        ])
      } finally {
        server.stop(true)
      }
    },
  )
})
