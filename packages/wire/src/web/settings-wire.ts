import { z } from 'zod'

export const settingSchema = z.object({ key: z.string(), value: z.string(), updatedAt: z.string() })
export type SettingWire = z.infer<typeof settingSchema>

export const settingListSchema = z.object({ settings: z.array(settingSchema) })
export type SettingList = z.infer<typeof settingListSchema>

export const settingsPatchSchema = z.strictObject({
  values: z.record(z.string(), z.string().nullable()),
})
export type SettingsPatch = z.infer<typeof settingsPatchSchema>
