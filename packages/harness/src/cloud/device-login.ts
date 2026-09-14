import { z } from 'zod'

import { CloudError } from './cloud-client'

export const CLOUD_CLIENT_ID = 'atlas-tui'

// RFC 8628 device authorization grant, as exposed by the better-auth device authorization plugin.
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

export type CloudLoginTicket = {
  url: string
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresInMs: number
  intervalMs: number
}

export enum ECloudLoginPoll {
  Pending = 'pending',
  SlowDown = 'slow-down',
  Denied = 'denied',
  Expired = 'expired',
  Approved = 'approved',
}

export type CloudLoginOutcome =
  | { status: ECloudLoginPoll.Pending }
  | { status: ECloudLoginPoll.SlowDown }
  | { status: ECloudLoginPoll.Denied }
  | { status: ECloudLoginPoll.Expired }
  | { status: ECloudLoginPoll.Approved; token: string }

const deviceCodeResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  verification_uri_complete: z.string().min(1).optional(),
  expires_in: z.number(),
  interval: z.number(),
})

const deviceTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
})

const deviceErrorSchema = z.object({ error: z.string() })

const SECOND_MS = 1_000

export const beginCloudLogin = async (args: {
  url: string
  fetchFn?: typeof fetch
}): Promise<CloudLoginTicket> => {
  const url = args.url.replace(/\/+$/, '')
  const fetchFn = args.fetchFn ?? fetch

  let response: Response
  try {
    response = await fetchFn(`${url}/api/auth/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: CLOUD_CLIENT_ID }),
    })
  } catch (cause) {
    throw new CloudError({
      status: 0,
      message: `The Atlas Cloud API at ${url} could not be reached — is the cloud API running? ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }

  if (!response.ok)
    throw new CloudError({
      status: response.status,
      message: `The Atlas Cloud API at ${url} refused a device login with ${response.status} — is the cloud API running?`,
    })

  const parsed = deviceCodeResponseSchema.parse(await response.json())

  return {
    url,
    deviceCode: parsed.device_code,
    userCode: parsed.user_code,
    verificationUrl: parsed.verification_uri_complete ?? parsed.verification_uri,
    expiresInMs: parsed.expires_in * SECOND_MS,
    intervalMs: parsed.interval * SECOND_MS,
  }
}

export const pollCloudLogin = async (args: {
  ticket: CloudLoginTicket
  fetchFn?: typeof fetch
}): Promise<CloudLoginOutcome> => {
  const { ticket } = args
  const fetchFn = args.fetchFn ?? fetch

  let response: Response
  try {
    response = await fetchFn(`${ticket.url}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: ticket.deviceCode,
        client_id: CLOUD_CLIENT_ID,
      }),
    })
  } catch (cause) {
    throw new CloudError({
      status: 0,
      message: `The Atlas Cloud API at ${ticket.url} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }

  const body: unknown = await response.json().catch(() => undefined)

  if (response.ok) {
    const parsed = deviceTokenResponseSchema.parse(body)
    return { status: ECloudLoginPoll.Approved, token: parsed.access_token }
  }

  const error = deviceErrorSchema.safeParse(body)
  if (error.success) {
    if (error.data.error === 'authorization_pending') return { status: ECloudLoginPoll.Pending }
    if (error.data.error === 'slow_down') return { status: ECloudLoginPoll.SlowDown }
    if (error.data.error === 'access_denied') return { status: ECloudLoginPoll.Denied }
    if (error.data.error === 'expired_token') return { status: ECloudLoginPoll.Expired }
  }

  throw new CloudError({
    status: response.status,
    message: `The Atlas Cloud API answered the device-token poll with ${response.status}.`,
  })
}
