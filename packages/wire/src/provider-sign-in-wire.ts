import { z } from 'zod'

import { accountDtoSchema } from './account-routes-wire'
import { EOauthProvider } from './oauth-connection-wire'

export enum EProviderSignInFlow {
  PasteCode = 'paste-code',
  DeviceCode = 'device-code',
}

export enum EProviderSignInPoll {
  Pending = 'pending',
  Complete = 'complete',
  Expired = 'expired',
}

export const providerSignInBeginInputSchema = z.strictObject({
  provider: z.enum(EOauthProvider),
})
export type ProviderSignInBeginInput = z.infer<typeof providerSignInBeginInputSchema>

export const providerSignInBeginSchema = z.discriminatedUnion('flow', [
  z.object({
    flow: z.literal(EProviderSignInFlow.PasteCode),
    attemptId: z.string().min(1),
    authorizeUrl: z.string().min(1),
    expiresInMs: z.number().int().positive(),
  }),
  z.object({
    flow: z.literal(EProviderSignInFlow.DeviceCode),
    attemptId: z.string().min(1),
    userCode: z.string().min(1),
    verificationUrl: z.string().min(1),
    intervalMs: z.number().int().positive(),
    expiresInMs: z.number().int().positive(),
  }),
])
export type ProviderSignInBegin = z.infer<typeof providerSignInBeginSchema>

export const providerSignInCompleteInputSchema = z.strictObject({
  attemptId: z.string().min(1),
  code: z.string().trim().min(1),
})
export type ProviderSignInCompleteInput = z.infer<typeof providerSignInCompleteInputSchema>

export const providerSignInPollInputSchema = z.strictObject({
  attemptId: z.string().min(1),
})
export type ProviderSignInPollInput = z.infer<typeof providerSignInPollInputSchema>

export const providerSignInPollSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(EProviderSignInPoll.Pending) }),
  z.object({ status: z.literal(EProviderSignInPoll.Expired) }),
  z.object({
    status: z.literal(EProviderSignInPoll.Complete),
    account: accountDtoSchema,
  }),
])
export type ProviderSignInPoll = z.infer<typeof providerSignInPollSchema>
