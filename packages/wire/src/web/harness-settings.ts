import { z } from 'zod'

import { ESettingConsumer, settingEntry } from './setting-entry'
import {
  EEffortLevel,
  effortSchema,
  EPlacementChooserShape,
  EVerdictTiming,
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
]
