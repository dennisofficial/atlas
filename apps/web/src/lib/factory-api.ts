import { UNREACHABLE } from './auth-api'

export class FactoryApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

export type FactoryConnection = {
  id: string
  provider: 'github' | 'linear' | 'model' | 'vercel'
  externalAccountId: string
  scopes: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type FactoryWorkItem = {
  id: string
  organizationId: string
  repo: string
  sourceKind: string
  status: string
  orchestratorThreadId: string | null
  driveName: string | null
  revisionCycles: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
}

export type FactorySettings = {
  model: {
    provider: string | null
    modelRef: string
    source: 'organization' | 'environment' | 'unconfigured'
    hasApiKey: boolean
  }
  vercel: { connected: boolean }
  decisions: { configured: boolean; url: string | null; hasToken: boolean }
}

const readBody = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json().catch(() => ({}))) as Record<string, unknown>

const failWith = async (response: Response, fallback: string): Promise<never> => {
  const body = await readBody(response)
  const message = typeof body.message === 'string' ? body.message : fallback
  throw new FactoryApiError(message, response.status)
}

const request = async (args: {
  path: string
  method?: 'GET' | 'PUT'
  body?: Record<string, string>
  fallback: string
}): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(args.path, {
      ...(args.method === undefined ? {} : { method: args.method }),
      ...(args.body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args.body),
          }),
    })
  } catch {
    throw new FactoryApiError(UNREACHABLE, null)
  }
  if (!response.ok) await failWith(response, args.fallback)
  return response
}

const readJson = async <T>(response: Response): Promise<T> =>
  (await response.json()) as T

export async function listConnections(): Promise<FactoryConnection[]> {
  const response = await request({
    path: '/v1/factory/connections',
    fallback: 'Could not load connections',
  })
  return readJson<FactoryConnection[]>(response)
}

export async function listWorkItems(args: { limit: number }): Promise<FactoryWorkItem[]> {
  const response = await request({
    path: `/v1/factory/work-items?limit=${args.limit}`,
    fallback: 'Could not load work items',
  })
  return readJson<FactoryWorkItem[]>(response)
}

export async function getFactorySettings(): Promise<FactorySettings> {
  const response = await request({
    path: '/v1/factory/settings',
    fallback: 'Could not load settings',
  })
  return readJson<FactorySettings>(response)
}

export async function saveModelSettings(args: {
  apiKey: string
  modelRef: string
}): Promise<void> {
  await request({
    path: '/v1/factory/settings/model',
    method: 'PUT',
    body: { apiKey: args.apiKey, modelRef: args.modelRef },
    fallback: 'Could not save model settings',
  })
}

export async function saveVercelSettings(args: { token: string }): Promise<void> {
  await request({
    path: '/v1/factory/settings/vercel',
    method: 'PUT',
    body: { token: args.token },
    fallback: 'Could not save the Vercel token',
  })
}

export async function saveDecisionsSettings(args: {
  url: string
  token?: string | undefined
}): Promise<void> {
  await request({
    path: '/v1/factory/settings/decisions',
    method: 'PUT',
    body: { url: args.url, ...(args.token === undefined ? {} : { token: args.token }) },
    fallback: 'Could not save the decision model settings',
  })
}
