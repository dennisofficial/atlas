import { EImageModelWire as EImageModel } from '@dltech/atlas-wire/web'

import {
  diffChanges,
  settingString,
  type ISettingChanges,
  type ISettingValues,
} from './setting-values'

export { EImageModel }

export const IMAGE_MODEL_ITEMS: ReadonlyArray<{ value: EImageModel; label: string }> = [
  { value: EImageModel.Gemini31FlashImage, label: 'Nano Banana 2' },
  { value: EImageModel.Gemini3ProImage, label: 'Nano Banana Pro' },
  { value: EImageModel.MaiImage27, label: 'MAI Image 2.7' },
  { value: EImageModel.MaiImage27Flash, label: 'MAI Image 2.7 Flash' },
  { value: EImageModel.GrokImagineImage20, label: 'Grok Imagine 2.0' },
]

export type IAgentSettings = { imageModel: EImageModel }

export const AGENT_SETTING_KEYS = {
  imageModel: 'images.model',
} as const satisfies Record<keyof IAgentSettings, string>

const oneOf = <TValue extends string>(args: {
  values: Record<string, TValue>
  value: string
  fallback: TValue
}): TValue => Object.values(args.values).find((entry) => entry === args.value) ?? args.fallback

export function agentSettingsFrom(values: ISettingValues): IAgentSettings {
  return {
    imageModel: oneOf({
      values: EImageModel,
      value: settingString({ values, key: AGENT_SETTING_KEYS.imageModel }),
      fallback: EImageModel.Gemini31FlashImage,
    }),
  }
}

export function agentSettingsChanges(args: {
  saved: IAgentSettings
  draft: IAgentSettings
}): ISettingChanges {
  return diffChanges({
    saved: { [AGENT_SETTING_KEYS.imageModel]: args.saved.imageModel },
    draft: { [AGENT_SETTING_KEYS.imageModel]: args.draft.imageModel },
  })
}
