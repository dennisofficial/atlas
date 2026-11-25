import { z } from 'zod'

import {
  fileMountContentsSchema,
  fileMountModeSchema,
  fileMountPathSchema,
} from './file-mounts-wire'
import { secretSetSchema } from './secrets-wire'
import { settingsPatchSchema } from './settings-wire'

export const DEFAULT_GROUP_FILE_MODE = 0o600

export const groupIdInputSchema = z.strictObject({ groupId: z.string().min(1) })
export type GroupIdInput = z.infer<typeof groupIdInputSchema>

export const groupSecretKeySchema = z.strictObject({
  groupId: z.string().min(1),
  name: z.string().min(1),
})
export type GroupSecretKey = z.infer<typeof groupSecretKeySchema>

export const groupSecretSetSchema = secretSetSchema.extend({
  ...groupSecretKeySchema.shape,
  grantId: z.string().min(1).optional(),
})
export type GroupSecretSet = z.infer<typeof groupSecretSetSchema>

export const groupFileMountKeySchema = z.strictObject({
  groupId: z.string().min(1),
  path: fileMountPathSchema,
})
export type GroupFileMountKey = z.infer<typeof groupFileMountKeySchema>

export const groupFileMountSetSchema = groupFileMountKeySchema.extend({
  contents: fileMountContentsSchema,
  mode: fileMountModeSchema.default(DEFAULT_GROUP_FILE_MODE),
  grantId: z.string().min(1).optional(),
})
export type GroupFileMountSet = z.input<typeof groupFileMountSetSchema>
export type GroupFileMountSetInput = z.output<typeof groupFileMountSetSchema>

export const groupSettingsPatchSchema = settingsPatchSchema.extend(groupIdInputSchema.shape)
export type GroupSettingsPatch = z.infer<typeof groupSettingsPatchSchema>
