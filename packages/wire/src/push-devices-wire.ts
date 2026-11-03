import { z } from 'zod'

// https://docs.expo.dev/push-notifications/sending-notifications/#push-tokens
export const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/

export enum EPushPlatform {
  Ios = 'ios',
  Android = 'android',
}

export const registerPushDeviceInputSchema = z.strictObject({
  token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN),
  platform: z.enum(EPushPlatform),
})
export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceInputSchema>

export const registerPushDeviceReplySchema = z.strictObject({
  id: z.string().min(1),
})
export type RegisterPushDeviceReply = z.infer<typeof registerPushDeviceReplySchema>

export const unregisterPushDeviceInputSchema = z.strictObject({
  token: z.string().regex(EXPO_PUSH_TOKEN_PATTERN),
})
export type UnregisterPushDeviceInput = z.infer<typeof unregisterPushDeviceInputSchema>

export const sendTestPushInputSchema = z.strictObject({})
export type SendTestPushInput = z.infer<typeof sendTestPushInputSchema>

export const sendTestPushReplySchema = z.strictObject({
  devices: z.number().int(),
})
export type SendTestPushReply = z.infer<typeof sendTestPushReplySchema>
