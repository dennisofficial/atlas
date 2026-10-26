export enum EMcpTransport {
  Stdio = 'stdio',
  Http = 'http',
}

export enum EMcpAuth {
  OAuth = 'oauth',
  Bearer = 'bearer',
  None = 'none',
}

export enum EMcpOAuthState {
  Connected = 'connected',
  SignInRequired = 'sign-in-required',
  Expired = 'expired',
  Failed = 'failed',
}

export enum EMcpScope {
  Personal = 'personal',
  Project = 'project',
}

export type McpEntry = { key: string; value: string; secret: boolean }

export type McpAuthConfig =
  | { kind: EMcpAuth.OAuth; clientId: string; clientSecret: string }
  | { kind: EMcpAuth.Bearer; token: string }
  | { kind: EMcpAuth.None }

export type McpRemoteSpec = {
  transport: EMcpTransport.Http
  url: string
  auth: McpAuthConfig
  headers: McpEntry[]
}

export type McpLocalSpec = {
  transport: EMcpTransport.Stdio
  command: string
  args: string[]
  env: McpEntry[]
}

export type McpSpec = McpRemoteSpec | McpLocalSpec

export type McpConnection = { state: EMcpOAuthState; account?: string; reason?: string }

export type McpServer = {
  name: string
  scope: EMcpScope
  enabled: boolean
  spec: McpSpec
  connection: McpConnection | null
}

export const MCP_ACCOUNT = 'dennis@dltech.dev'

function oauthRemote(url: string): McpRemoteSpec {
  return {
    transport: EMcpTransport.Http,
    url,
    auth: { kind: EMcpAuth.OAuth, clientId: '', clientSecret: '' },
    headers: [],
  }
}

function local({
  command,
  args,
  env = [],
}: {
  command: string
  args: string[]
  env?: McpEntry[]
}): McpLocalSpec {
  return { transport: EMcpTransport.Stdio, command, args, env }
}

const POSTGRES_SPEC = local({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-postgres'],
  env: [{ key: 'DATABASE_URL', value: '${DATABASE_URL}', secret: false }],
})

const LINEAR: McpServer = {
  name: 'linear',
  scope: EMcpScope.Personal,
  enabled: true,
  spec: oauthRemote('https://mcp.linear.app/mcp'),
  connection: { state: EMcpOAuthState.Connected, account: MCP_ACCOUNT },
}

const POSTHOG: McpServer = {
  name: 'posthog',
  scope: EMcpScope.Personal,
  enabled: true,
  spec: oauthRemote('https://mcp.posthog.com/mcp'),
  connection: { state: EMcpOAuthState.SignInRequired },
}

const SENTRY: McpServer = {
  name: 'sentry',
  scope: EMcpScope.Personal,
  enabled: true,
  spec: oauthRemote('https://mcp.sentry.dev/mcp'),
  connection: { state: EMcpOAuthState.Expired },
}

const NOTION: McpServer = {
  name: 'notion',
  scope: EMcpScope.Personal,
  enabled: true,
  spec: oauthRemote('https://mcp.notion.com/mcp'),
  connection: { state: EMcpOAuthState.Failed, reason: 'token request returned 502' },
}

const CONTEXT7: McpServer = {
  name: 'context7',
  scope: EMcpScope.Personal,
  enabled: true,
  spec: {
    transport: EMcpTransport.Http,
    url: 'https://mcp.context7.com/mcp',
    auth: { kind: EMcpAuth.None },
    headers: [],
  },
  connection: null,
}

const PLAYWRIGHT: McpServer = {
  name: 'playwright',
  scope: EMcpScope.Personal,
  enabled: true,
  spec: local({ command: 'npx', args: ['@playwright/mcp@latest', '--headless'] }),
  connection: null,
}

const POSTGRES: McpServer = {
  name: 'postgres',
  scope: EMcpScope.Personal,
  enabled: false,
  spec: POSTGRES_SPEC,
  connection: null,
}

export const PERSONAL_MCP_SERVERS: McpServer[] = [
  LINEAR,
  POSTHOG,
  SENTRY,
  CONTEXT7,
  PLAYWRIGHT,
  POSTGRES,
]

export const OAUTH_STATE_MCP_SERVERS: McpServer[] = [LINEAR, POSTHOG, SENTRY, NOTION]

export const PROJECT_MCP_SERVERS: McpServer[] = [
  {
    name: 'linear',
    scope: EMcpScope.Project,
    enabled: true,
    spec: oauthRemote('https://mcp.linear.app/mcp'),
    connection: { state: EMcpOAuthState.Connected, account: MCP_ACCOUNT },
  },
  {
    name: 'postgres',
    scope: EMcpScope.Project,
    enabled: true,
    spec: POSTGRES_SPEC,
    connection: null,
  },
  {
    name: 'figma',
    scope: EMcpScope.Project,
    enabled: true,
    spec: {
      transport: EMcpTransport.Http,
      url: 'https://mcp.figma.com/mcp',
      auth: { kind: EMcpAuth.Bearer, token: '${FIGMA_TOKEN}' },
      headers: [],
    },
    connection: null,
  },
]

export const PROJECT_MCP_ROWS: McpServer[] = [...PROJECT_MCP_SERVERS, ...PERSONAL_MCP_SERVERS]

export const MCP_IMPORT_SAMPLE = JSON.stringify(
  {
    mcpServers: {
      notion: { type: 'sse', url: 'https://mcp.notion.com/sse' },
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' },
      },
      'brave-search': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: { BRAVE_API_KEY: '${env:BRAVE_API_KEY}' },
      },
    },
  },
  null,
  2,
)
