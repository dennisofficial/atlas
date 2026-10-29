import { z } from 'zod'

import { ESettingConsumer, settingEntry } from './setting-entry'
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
]
