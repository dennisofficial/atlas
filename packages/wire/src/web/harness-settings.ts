import { z } from 'zod'

import { PINNED_MODELS_FALLBACK, pinnedModelsSettingSchema } from './pinned-models'

import { ESettingConsumer, prefixEntry, settingEntry } from './setting-entry'
import {
  DEFAULT_DECISIONS_MODEL_WIRE,
  DEFAULT_DECISIONS_PROVIDER_WIRE,
  decisionsUrlSchema,
  EClassifierModeWire,
  EDecisionsProviderWire,
  EEffortLevel,
  effortSchema,
  EPlacementChooserShape,
  EVerdictTiming,
  EWebSearchBackendWire,
  modelRefSettingSchema,
  sandboxVcpusSchema,
} from './setting-enums'

export const PR_EDIT_MUTED_AUTHORS_WIRE_FALLBACK = 'vercel, github-actions, netlify, mintlify'

export const USER_ONLY_SETTING_ENTRIES = [
  settingEntry({
    key: 'plugins.trustedRepos',
    schema: z.string(),
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
]

export const HARNESS_SETTING_ENTRIES = [
  settingEntry({
    key: 'model.id',
    schema: modelRefSettingSchema,
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'model.effort',
    schema: effortSchema,
    fallback: EEffortLevel.Medium,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'agents.subagentModel',
    schema: modelRefSettingSchema,
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'sandbox.vcpus',
    schema: sandboxVcpusSchema,
    fallback: 2,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'experimental.grillingCeremony',
    schema: z.boolean(),
    fallback: false,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'model.favourites',
    schema: pinnedModelsSettingSchema,
    fallback: PINNED_MODELS_FALLBACK,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'experimental.placementChooserShape',
    schema: z.enum(EPlacementChooserShape),
    fallback: EPlacementChooserShape.Chip,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'github.prEvents.verdictTiming',
    schema: z.enum(EVerdictTiming),
    fallback: EVerdictTiming.FailFast,
    consumer: ESettingConsumer.Api,
  }),
  settingEntry({
    key: 'github.prEvents.editMutedAuthors',
    schema: z.string(),
    fallback: PR_EDIT_MUTED_AUTHORS_WIRE_FALLBACK,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'github.prEvents.editUrgentAuthors',
    schema: z.string(),
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'decisions.provider',
    schema: z.enum(EDecisionsProviderWire),
    fallback: DEFAULT_DECISIONS_PROVIDER_WIRE,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'decisions.url',
    schema: decisionsUrlSchema,
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'decisions.model',
    schema: z.string(),
    fallback: DEFAULT_DECISIONS_MODEL_WIRE,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'classifier.mode',
    schema: z.enum(EClassifierModeWire),
    fallback: EClassifierModeWire.Shadow,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'web.searchBackend',
    schema: z.enum(EWebSearchBackendWire),
    fallback: EWebSearchBackendWire.DuckDuckGo,
    consumer: ESettingConsumer.Harness,
  }),
  ...[
    'context.projectInstructions',
    'context.userInstructions',
    'context.reload',
    'skills.suggest',
  ].map((key) =>
    settingEntry({
      key,
      schema: z.boolean(),
      fallback: true,
      consumer: ESettingConsumer.Harness,
    }),
  ),
  settingEntry({
    key: 'context.filenames',
    schema: z.enum(['both', 'claude', 'agents', 'none']),
    fallback: 'both',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'context.autoCompact',
    schema: z.number().int().min(0).max(100),
    fallback: 90,
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'worktree.directory',
    schema: z.string().min(1),
    fallback: '.atlas/worktrees',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'model.quickModel',
    schema: modelRefSettingSchema,
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'model.compactionModel',
    schema: modelRefSettingSchema,
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
  settingEntry({
    key: 'sandbox.image',
    schema: z.string(),
    fallback: 'atlas-sandbox:latest',
    consumer: ESettingConsumer.Harness,
  }),
  ...['quality.enabled', 'quality.recordExamples'].map((key) =>
    settingEntry({
      key,
      schema: z.boolean(),
      fallback: false,
      consumer: ESettingConsumer.Harness,
    }),
  ),
]

export const HARNESS_SETTING_PREFIXES = [
  prefixEntry({
    prefix: 'agents.type.',
    schema: modelRefSettingSchema,
    fallback: '',
    consumer: ESettingConsumer.Harness,
  }),
  prefixEntry({
    prefix: 'quality.policies.',
    schema: z.boolean(),
    fallback: false,
    consumer: ESettingConsumer.Harness,
  }),
]
