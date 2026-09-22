const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

export interface LinearTokenResponse {
  accessToken: string
  expiresIn: number
}

interface LinearTokenBody {
  access_token?: unknown
  expires_in?: unknown
}

async function postTokenRequest(args: { body: URLSearchParams }): Promise<LinearTokenResponse> {
  const response = await fetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: args.body.toString(),
  })
  if (!response.ok) {
    throw new Error(`linear token request failed with status ${response.status}`)
  }
  const body = (await response.json()) as LinearTokenBody
  if (typeof body.access_token !== 'string') {
    throw new Error('linear token request returned no access token')
  }
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 0,
  }
}

// Error paths here never include response bodies: token responses carry secrets.
export async function exchangeCodeForToken(args: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<LinearTokenResponse> {
  return postTokenRequest({
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  })
}

export async function mintClientCredentialsToken(args: {
  clientId: string
  clientSecret: string
  scope: string
}): Promise<LinearTokenResponse> {
  const basic = Buffer.from(`${args.clientId}:${args.clientSecret}`).toString('base64')
  const response = await fetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: args.scope,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`linear client credentials request failed with status ${response.status}`)
  }
  const body = (await response.json()) as LinearTokenBody
  if (typeof body.access_token !== 'string') {
    throw new Error('linear client credentials request returned no access token')
  }
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 0,
  }
}

// The app-actor token answers for the workspace it was minted in, so organization.id is the
// workspace id webhook payloads carry as organizationId.
export async function fetchOrganizationId(args: { accessToken: string }): Promise<string> {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({ query: '{ organization { id } }' }),
  })
  if (!response.ok) {
    throw new Error(`linear organization query failed with status ${response.status}`)
  }
  const body = (await response.json()) as { data?: { organization?: { id?: unknown } } }
  const id = body.data?.organization?.id
  if (typeof id !== 'string') {
    throw new Error('linear organization query returned no id')
  }
  return id
}
