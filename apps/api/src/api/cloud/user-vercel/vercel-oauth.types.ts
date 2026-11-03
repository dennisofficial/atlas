import { z } from 'zod'

export const VERCEL_OAUTH_PENDING_TAG = 'https://vercel.com/oauth/authorize'
export const VERCEL_OAUTH_CALLBACK_PATH = '/v1/vercel/oauth/callback'

export const sealedVercelPendingSchema = z.strictObject({
  codeVerifier: z.string(),
  nonce: z.string(),
})

export type VercelFetch = (input: string, init?: RequestInit) => Promise<Response>

export class VercelFetcher {
  fetch: VercelFetch = fetch
}

export class VercelOauthConfig {
  redirectUri!: string
  webOrigin!: string
}
