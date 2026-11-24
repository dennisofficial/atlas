import { EImageModelWire as EImageModel } from '@dltech/atlas-wire/web'

import type { ChoiceItem } from './settings-choice'

export { EImageModel }

export const IMAGE_MODEL_ITEMS: ChoiceItem<EImageModel>[] = [
  { value: EImageModel.Gemini31FlashImage, label: 'Nano Banana 2' },
  { value: EImageModel.Gemini3ProImage, label: 'Nano Banana Pro' },
  { value: EImageModel.MaiImage27, label: 'MAI Image 2.7' },
  { value: EImageModel.MaiImage27Flash, label: 'MAI Image 2.7 Flash' },
  { value: EImageModel.GrokImagineImage20, label: 'Grok Imagine 2.0' },
]
