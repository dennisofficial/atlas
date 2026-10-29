import { BadGatewayException } from '@nestjs/common'
import { EGithubCallSource } from '../github/github-call-log'
import type { FetchFn, GithubHttpRequest, GithubHttpResponse } from '../github/github-device-client'
import { defaultGithubFetch } from '../github/github-device-client'

const API_BASE = 'https://api.github.com'
const TIMEOUT_MS = 8_000
const KEYS_PATH = '/user/ssh_signing_keys'
const LIST_PAGE_SIZE = 100

export interface RegisteredKey {
  id: number
  created: boolean
}

export class SigningScopeMissing extends Error {
  constructor() {
    super('github refused the signing key call for lack of scope')
  }
}

async function readJson(response: GithubHttpResponse): Promise<unknown> {
  try {
    return JSON.parse(await response.text())
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value))
}

function unexpected(args: { operation: string; status: number }): BadGatewayException {
  return new BadGatewayException(`github ${args.operation} failed with status ${args.status}`)
}

const isScopeRefusal = (status: number): boolean =>
  status === 401 || status === 403 || status === 404

export class GithubSigningKeysClient {
  private readonly fetchFn: FetchFn

  constructor(args: { fetchFn?: FetchFn }) {
    this.fetchFn = args.fetchFn ?? defaultGithubFetch({ source: EGithubCallSource.SigningKey })
  }

  async identity(args: { token: string }): Promise<{ id: number; login: string }> {
    const response = await this.send({ method: 'GET', path: '/user', token: args.token })
    if (response.status === 401) throw new SigningScopeMissing()
    if (!response.ok) throw unexpected({ operation: 'identity lookup', status: response.status })
    const body = asRecord(await readJson(response))
    if (typeof body.id !== 'number' || typeof body.login !== 'string' || body.login.length === 0) {
      throw new BadGatewayException('github returned an unexpected identity')
    }
    return { id: body.id, login: body.login }
  }

  async register(args: { token: string; key: string; title: string }): Promise<RegisteredKey> {
    const response = await this.send({
      method: 'POST',
      path: KEYS_PATH,
      token: args.token,
      body: JSON.stringify({ key: args.key, title: args.title }),
    })
    if (response.status === 201) return { ...this.idFrom(await readJson(response)), created: true }
    if (response.status === 422) return this.adopt({ token: args.token, key: args.key })
    if (isScopeRefusal(response.status)) throw new SigningScopeMissing()
    throw unexpected({ operation: 'signing key upload', status: response.status })
  }

  async remove(args: { token: string; keyId: number }): Promise<'removed'> {
    const response = await this.send({
      method: 'DELETE',
      path: `${KEYS_PATH}/${args.keyId}`,
      token: args.token,
    })
    if (response.status === 204 || response.status === 404) return 'removed'
    if (response.status === 401 || response.status === 403) throw new SigningScopeMissing()
    throw unexpected({ operation: 'signing key removal', status: response.status })
  }

  private async adopt(args: { token: string; key: string }): Promise<RegisteredKey> {
    const response = await this.send({
      method: 'GET',
      path: `${KEYS_PATH}?per_page=${LIST_PAGE_SIZE}`,
      token: args.token,
    })
    if (isScopeRefusal(response.status)) throw new SigningScopeMissing()
    if (!response.ok)
      throw unexpected({ operation: 'signing key listing', status: response.status })
    const listed = await readJson(response)
    const match = Array.isArray(listed)
      ? listed.map(asRecord).find((entry) => sameKey({ listed: entry.key, wanted: args.key }))
      : undefined
    if (match === undefined) throw new BadGatewayException('github rejected the signing key')
    return { ...this.idFrom(match), created: false }
  }

  private idFrom(value: unknown): { id: number } {
    const id = asRecord(value).id
    if (typeof id !== 'number') throw new BadGatewayException('github returned no signing key id')
    return { id }
  }

  private send(args: {
    method: GithubHttpRequest['method']
    path: string
    token: string
    body?: string
  }): Promise<GithubHttpResponse> {
    return this.fetchFn(`${API_BASE}${args.path}`, {
      method: args.method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${args.token}`,
        ...(args.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(args.body === undefined ? {} : { body: args.body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
}

function sameKey(args: { listed: unknown; wanted: string }): boolean {
  if (typeof args.listed !== 'string') return false
  return (
    args.listed.trim().split(/\s+/).slice(0, 2).join(' ') ===
    args.wanted.trim().split(/\s+/).slice(0, 2).join(' ')
  )
}
