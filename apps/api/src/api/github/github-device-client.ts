import { BadGatewayException } from '@nestjs/common'
import type { GithubDeviceCodesDto } from './github.types'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const REQUESTED_SCOPES = 'repo workflow read:org'

export interface GithubHttpRequest {
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

export interface GithubHttpResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type FetchFn = (url: string, request: GithubHttpRequest) => Promise<GithubHttpResponse>

export type GithubPollOutcome =
  | { kind: 'granted'; accessToken: string; scope: string }
  | { kind: 'error'; error: string; description?: string }

async function readJson(response: GithubHttpResponse): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await response.text())
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadGatewayException(`github returned an unexpected response (missing ${key})`)
  }
  return value
}

function requireSeconds(body: Record<string, unknown>, key: string): number {
  const value = body[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadGatewayException(`github returned an unexpected response (missing ${key})`)
  }
  return value * 1000
}

function gatewayFailure(
  operation: string,
  body: Record<string, unknown>,
  status: number,
): BadGatewayException {
  const description = body.error_description
  if (typeof description === 'string' && description.length > 0) {
    return new BadGatewayException(description)
  }
  return new BadGatewayException(`${operation} failed with status ${status}`)
}

export class GithubDeviceClient {
  private readonly fetchFn: FetchFn

  constructor(args: { fetchFn?: FetchFn } = {}) {
    this.fetchFn = args.fetchFn ?? fetch
  }

  async beginDeviceFlow(args: { clientId: string }): Promise<GithubDeviceCodesDto> {
    const response = await this.fetchFn(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: args.clientId, scope: REQUESTED_SCOPES }),
    })
    const body = await readJson(response)
    if (!response.ok) throw gatewayFailure('github device flow begin', body, response.status)
    return {
      deviceCode: requireString(body, 'device_code'),
      userCode: requireString(body, 'user_code'),
      verificationUrl: requireString(body, 'verification_uri'),
      expiresInMs: requireSeconds(body, 'expires_in'),
      intervalMs: requireSeconds(body, 'interval'),
    }
  }

  async pollDeviceToken(args: {
    clientId: string
    deviceCode: string
  }): Promise<GithubPollOutcome> {
    const response = await this.fetchFn(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: args.clientId,
        device_code: args.deviceCode,
        grant_type: DEVICE_GRANT_TYPE,
      }),
    })
    const body = await readJson(response)
    if (!response.ok) throw gatewayFailure('github token poll', body, response.status)
    const error = body.error
    if (typeof error === 'string' && error.length > 0) {
      const description = body.error_description
      return {
        kind: 'error',
        error,
        ...(typeof description === 'string' && description.length > 0 ? { description } : {}),
      }
    }
    return {
      kind: 'granted',
      accessToken: requireString(body, 'access_token'),
      scope: typeof body.scope === 'string' ? body.scope : '',
    }
  }

  async verifyToken(args: { accessToken: string }): Promise<{ login: string }> {
    const response = await this.fetchFn(USER_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
      },
    })
    const body = await readJson(response)
    if (!response.ok) throw gatewayFailure('github token verification', body, response.status)
    return { login: requireString(body, 'login') }
  }
}
