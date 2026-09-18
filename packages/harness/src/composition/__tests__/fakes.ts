import {
  catalogOf,
  EAuthKind,
  EEffort,
  EImageTier,
  findCard,
  toAccountId,
  type Credential,
  type CredentialPort,
  type EffortMap,
  type ModelCard,
  type NoticePost,
  type NoticePort,
} from '@dltech/atlas-core'

import { ESkillOrigin, parseSkill, type DiscoveredSkill } from '../../skills'
import { DEFAULT_MODEL_REF } from '../config'
import type { ModelCatalogue } from '../model-catalogue'

const CREDENTIAL: Credential = {
  kind: EAuthKind.Oauth,
  accountId: toAccountId('acc_fake'),
  accessToken: 'not-a-real-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

export const alwaysAuthorised = (): CredentialPort => ({
  read: async () => CREDENTIAL,
  discard: async () => {},
})

const fakeCard = (args: {
  providerId: string
  modelId: string
  label: string
  price: number
  effort?: EffortMap | undefined
}): ModelCard => ({
  ref: { providerId: args.providerId, modelId: args.modelId },
  label: args.label,
  api: 'messages',
  contextWindow: 200_000,
  imageTier: EImageTier.HighResolution,
  cost: { inputPerMillion: 1, outputPerMillion: args.price },
  ...(args.effort === undefined ? {} : { effort: args.effort }),
})

const LADDER: EffortMap = {
  [EEffort.Low]: 'low',
  [EEffort.Medium]: 'medium',
  [EEffort.High]: 'high',
}

const CLAUDE_CARDS: readonly ModelCard[] = [
  fakeCard({
    providerId: 'anthropic',
    modelId: 'claude-opus-5',
    label: 'opus-5',
    price: 25,
    effort: LADDER,
  }),
  fakeCard({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-5',
    label: 'sonnet-5',
    price: 15,
    effort: LADDER,
  }),
  fakeCard({
    providerId: DEFAULT_MODEL_REF.providerId,
    modelId: DEFAULT_MODEL_REF.modelId,
    label: 'haiku-4-5',
    price: 5,
    effort: LADDER,
  }),
]

const CODEX_CARDS: readonly ModelCard[] = [
  fakeCard({
    providerId: 'openai',
    modelId: 'gpt-5-codex',
    label: 'gpt-5-codex',
    price: 10,
    effort: LADDER,
  }),
]

const FAKE_CATALOG = catalogOf([...CLAUDE_CARDS, ...CODEX_CARDS])

/** Anthropic is keyed and OpenAI is not, so the `⚠ no key` row still has something to say. */
export function fakeCatalogue(): ModelCatalogue {
  return {
    providers: [
      { id: 'anthropic', label: 'Claude Plan', cards: CLAUDE_CARDS },
      { id: 'openai', label: 'Codex Plan', cards: CODEX_CARDS },
    ],
    catalog: FAKE_CATALOG,
    cardFor: (ref) => findCard({ catalog: FAKE_CATALOG, ref }),
    adapterFor: () => undefined,
    reachable: (providerId) => providerId === 'anthropic',
    subscribed: () => true,
    observeAccounts: () => {},
    subscribe: () => () => {},
    version: () => 0,
  }
}

export function fakeSkill(args: {
  name: string
  summary?: string
  userInvocable?: boolean
  body?: string
}): DiscoveredSkill {
  const skill = parseSkill({
    text: [
      '---',
      `name: ${args.name}`,
      `description: ${args.summary ?? `the ${args.name} skill`}`,
      `user-invocable: ${args.userInvocable ?? true}`,
      '---',
      args.body ?? `Behave as ${args.name} would.`,
    ].join('\n'),
    fallbackName: args.name,
    origin: ESkillOrigin.User,
  })

  if (skill === undefined) throw new Error(`the fake skill ${args.name} did not parse`)
  return skill
}

export type FakeSkills = {
  readonly reloads: number
  place(skill: DiscoveredSkill): void
  drop(name: string): void
  all(): readonly DiscoveredSkill[]
  byName(name: string): DiscoveredSkill | undefined
  reload(): Promise<readonly DiscoveredSkill[]>
}

export function fakeSkillRegistry(args: { skills: readonly DiscoveredSkill[] }): FakeSkills {
  const onDisk: DiscoveredSkill[] = [...args.skills]
  let loaded: readonly DiscoveredSkill[] = [...args.skills]
  let reloads = 0

  return {
    get reloads() {
      return reloads
    },

    place: (skill) => {
      onDisk.push(skill)
    },

    drop: (name) => {
      const at = onDisk.findIndex((one) => one.spec.name === name)
      if (at !== -1) onDisk.splice(at, 1)
    },

    all: () => loaded,

    byName: (name) => loaded.find((one) => one.spec.name === name),

    reload: async () => {
      reloads += 1
      loaded = [...onDisk]
      return loaded
    },
  }
}

export type RecordedNotices = {
  readonly posts: readonly NoticePost[]
  port: NoticePort
}

export function recordingNotices(): RecordedNotices {
  const posts: NoticePost[] = []
  return {
    posts,
    port: {
      notify: (post) => {
        posts.push(post)
      },
    },
  }
}
