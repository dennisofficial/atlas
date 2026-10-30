import { EAccountStatus, EAuthKind } from '@dltech/atlas-core'

type Json = Record<string, unknown>

export type FakeAccountCloud = {
  url: string
  accounts: Json[]
  actives: Map<string, string>
  secrets: Map<string, string>
  uploads: Json[]
  calls: string[]
  failOn: Set<string>
  stop: () => void
}

const STAMP = '2026-10-30T00:00:00.000Z'

const data = (value: unknown): Response => Response.json({ result: { data: value } })

const failure = (status: number): Response =>
  Response.json(
    {
      error: {
        message: 'fake cloud failure',
        code: -32603,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: status },
      },
    },
    { status },
  )

const withoutSecret = ({ secret: _secret, ...account }: Json): Json => account

const inputOf = async (request: Request): Promise<Json> => {
  const url = new URL(request.url)
  const raw = request.method === 'GET' ? url.searchParams.get('input') : await request.text()
  return raw === null || raw === '' ? {} : (JSON.parse(raw) as Json)
}

export function startFakeAccountCloud(): FakeAccountCloud {
  const cloud: Omit<FakeAccountCloud, 'url' | 'stop'> = {
    accounts: [],
    actives: new Map(),
    secrets: new Map(),
    uploads: [],
    calls: [],
    failOn: new Set(),
  }

  const handle = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname
    if (path === '/v1/health') return Response.json({ status: 'ok' })
    if (path === '/api/auth/get-session')
      return Response.json({ user: { email: 'dennis@example.test' } })
    if (!path.startsWith('/v1/trpc/')) return failure(404)

    const procedure = path.slice('/v1/trpc/'.length)
    cloud.calls.push(procedure)
    if (cloud.failOn.has(procedure)) return failure(503)
    const input = await inputOf(request)
    const find = () => cloud.accounts.find((account) => account['id'] === input['accountId'])

    switch (procedure) {
      case 'accounts.list':
        return data(cloud.accounts.map(withoutSecret))
      case 'accounts.get': {
        const found = find()
        return found === undefined ? failure(404) : data(found)
      }
      case 'accounts.create': {
        const secret = input['secret'] as Json
        const account: Json = {
          ...input,
          id: `acc_cloud_${cloud.accounts.length + 1}`,
          kind: secret['kind'],
          status: EAccountStatus.Active,
          createdAt: STAMP,
          updatedAt: STAMP,
        }
        cloud.accounts.push(account)
        const provider = String(input['provider'])
        if (!cloud.actives.has(provider)) cloud.actives.set(provider, String(account['id']))
        return data(withoutSecret(account))
      }
      case 'accounts.replaceSecret': {
        const found = find()
        if (found === undefined) return failure(404)
        found['secret'] = input['secret']
        return data(null)
      }
      case 'accounts.setActive':
        cloud.actives.set(String(input['provider']), String(input['accountId']))
        return data(null)
      case 'accounts.active':
        return data({
          accountId: cloud.actives.get(String(input['provider'])) ?? null,
        })
      case 'harnessSecrets.list':
        return data({
          secrets: [...cloud.secrets].map(([name, value]) => ({
            name,
            value,
            updatedAt: STAMP,
          })),
        })
      case 'harnessSecrets.set':
        cloud.secrets.set(String(input['name']), String(input['value']))
        return data(null)
      case 'settings.list':
        return data({ settings: [] })
      case 'oauthConnections.upload':
        cloud.uploads.push(input)
        return data({
          accessToken: 'cloud-minted-access',
          expiresAt: '2099-01-01T00:00:00.000Z',
          generation: 1,
          authorizationId: `auth_${String(input['connectionId'])}`,
        })
      default:
        return data(null)
    }
  }

  const server = Bun.serve({ port: 0, fetch: handle })
  return {
    ...cloud,
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  }
}

export const oauthAuthorityOf = (account: Json | undefined): Json | undefined => {
  const secret = account?.['secret'] as Json | undefined
  if (secret?.['kind'] !== EAuthKind.Oauth) return undefined
  return secret['authority'] as Json | undefined
}
