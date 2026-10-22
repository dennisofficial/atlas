import { z } from 'zod'

import type { CloudSettingEntry } from './setting-entry'
import { ESettingConsumer, settingEntry } from './setting-entry'
import {
  EDensity,
  EEffortLevel,
  effortSchema,
  EModelPreset,
  ETheme,
  NOTIFY_CHANNEL_IDS,
  NOTIFY_EVENT_IDS,
  QUIET_HOUR_PATTERN,
} from './setting-enums'

const webEntry = (args: {
  key: string
  schema: CloudSettingEntry['schema']
  fallback: CloudSettingEntry['fallback']
}): [string, CloudSettingEntry] => settingEntry({ ...args, consumer: ESettingConsumer.None })

const boolEntry = (args: { key: string; fallback: boolean }) =>
  webEntry({ key: args.key, schema: z.boolean(), fallback: args.fallback })

const NOTIFY_DEFAULTS: Record<(typeof NOTIFY_EVENT_IDS)[number], readonly boolean[]> = {
  finished: [true, true, false],
  approval: [true, true, true],
  errored: [true, true, true],
  checks: [true, false, true],
  mention: [true, true, true],
  paused: [true, false, false],
}

const notifyEventEntries = NOTIFY_EVENT_IDS.flatMap((event) =>
  NOTIFY_CHANNEL_IDS.map((channel, index) =>
    boolEntry({
      key: `web.notifications.event.${event}.${channel}`,
      fallback: NOTIFY_DEFAULTS[event][index] ?? false,
    }),
  ),
)

const EXPERIMENTAL_DEFAULTS: ReadonlyArray<readonly [string, boolean]> = [
  ['parallelToolCalls', true],
  ['speculativeClassifier', false],
  ['autoCompact', true],
  ['bornInCloud', false],
  ['webTerminal', true],
  ['planModeDefault', false],
]

export const WEB_ONLY_SETTING_ENTRIES = [
  webEntry({
    key: 'web.models.preset',
    schema: z.enum(EModelPreset),
    fallback: EModelPreset.Balanced,
  }),
  webEntry({
    key: 'web.models.subagentEffort',
    schema: effortSchema,
    fallback: EEffortLevel.Medium,
  }),
  webEntry({ key: 'web.models.classifierModel', schema: z.string(), fallback: '' }),
  webEntry({
    key: 'web.models.classifierEffort',
    schema: effortSchema,
    fallback: EEffortLevel.Low,
  }),
  ...EXPERIMENTAL_DEFAULTS.map(([name, fallback]) =>
    boolEntry({ key: `web.experimental.${name}`, fallback }),
  ),
  webEntry({ key: 'web.appearance.theme', schema: z.enum(ETheme), fallback: ETheme.Dark }),
  webEntry({
    key: 'web.appearance.density',
    schema: z.enum(EDensity),
    fallback: EDensity.Comfortable,
  }),
  webEntry({
    key: 'web.appearance.codeFontSize',
    schema: z.union([z.literal(12), z.literal(13), z.literal(14)]),
    fallback: 13,
  }),
  boolEntry({ key: 'web.appearance.showDiffStat', fallback: true }),
  boolEntry({ key: 'web.appearance.reduceMotion', fallback: false }),
  boolEntry({ key: 'web.notifications.channel.push', fallback: true }),
  boolEntry({ key: 'web.notifications.channel.email', fallback: true }),
  boolEntry({ key: 'web.notifications.channel.slack', fallback: false }),
  ...notifyEventEntries,
  boolEntry({ key: 'web.notifications.quietHours', fallback: true }),
  webEntry({
    key: 'web.notifications.quietFrom',
    schema: z.string().regex(QUIET_HOUR_PATTERN),
    fallback: '22:00',
  }),
  webEntry({
    key: 'web.notifications.quietTo',
    schema: z.string().regex(QUIET_HOUR_PATTERN),
    fallback: '07:00',
  }),
]
