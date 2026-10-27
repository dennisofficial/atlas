import { ESecretKind, ESecretsScope, type LibrarySecret } from './settings-library'
import {
  EMcpAuth,
  EMcpOAuthState,
  EMcpScope,
  EMcpTransport,
  MCP_ACCOUNT,
  type McpServer,
} from './settings-mcp'

export enum EWorkspaceRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export type SelectOption = { value: string; label: string }

export type WorkspaceMember = {
  id: string
  name: string
  email: string
  initials: string
  role: EWorkspaceRole
  joined: string
  lastActive: string
}

export type PendingInvite = {
  id: string
  email: string
  role: EWorkspaceRole
  invitedBy: string
  expiresInDays: number
}

export type WorkspaceProfile = {
  id: string
  name: string
  slug: string
  region: string
  model: string
  createdAt: string
}

export type WorkspaceVercelView = {
  configured: boolean
  tokenHint: string
  teamId: string
  vercelProjectId: string
  updatedAt: string
}

export const ROLE_LABELS: Record<EWorkspaceRole, string> = {
  [EWorkspaceRole.Owner]: 'Owner',
  [EWorkspaceRole.Admin]: 'Admin',
  [EWorkspaceRole.Member]: 'Member',
}

export const ASSIGNABLE_ROLES: EWorkspaceRole[] = [EWorkspaceRole.Admin, EWorkspaceRole.Member]

export const ASSIGNABLE_ROLE_OPTIONS: SelectOption[] = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}))

export function parseRole(value: string | null): EWorkspaceRole | null {
  return Object.values(EWorkspaceRole).find((role) => role === value) ?? null
}

export const REGION_OPTIONS: SelectOption[] = [
  { value: 'iad1', label: 'iad1 · Washington, D.C.' },
  { value: 'sfo1', label: 'sfo1 · San Francisco' },
  { value: 'fra1', label: 'fra1 · Frankfurt' },
]

export const NO_DEFAULT_MODEL = 'none'

export const DEFAULT_MODEL_OPTIONS: SelectOption[] = [
  { value: NO_DEFAULT_MODEL, label: 'No default' },
  { value: 'claude-sonnet', label: 'Claude Sonnet' },
  { value: 'claude-opus', label: 'Claude Opus' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gpt-5-mini', label: 'GPT-5 mini' },
]

export const WORKSPACE_PROFILE: WorkspaceProfile = {
  id: 'org_7Kq2mXvR9tNb4LcD',
  name: 'DL Tech',
  slug: 'dltech',
  region: 'iad1',
  model: 'claude-sonnet',
  createdAt: 'Mar 4, 2026',
}

export const CURRENT_MEMBER_ID = 'wm1'

export const WORKSPACE_MEMBERS: WorkspaceMember[] = [
  {
    id: 'wm1',
    name: 'Dennis Lysenko',
    email: 'dennis@dltech.dev',
    initials: 'DL',
    role: EWorkspaceRole.Owner,
    joined: 'Mar 4, 2026',
    lastActive: '2m ago',
  },
  {
    id: 'wm2',
    name: 'Maya Okafor',
    email: 'maya@dltech.dev',
    initials: 'MO',
    role: EWorkspaceRole.Admin,
    joined: 'Mar 11, 2026',
    lastActive: '1h ago',
  },
  {
    id: 'wm3',
    name: 'Tomas Brandt',
    email: 'tomas@dltech.dev',
    initials: 'TB',
    role: EWorkspaceRole.Member,
    joined: 'Apr 2, 2026',
    lastActive: '3h ago',
  },
  {
    id: 'wm4',
    name: 'Priya Raman',
    email: 'priya@dltech.dev',
    initials: 'PR',
    role: EWorkspaceRole.Member,
    joined: 'May 19, 2026',
    lastActive: 'Yesterday',
  },
  {
    id: 'wm5',
    name: 'Jonas Weber',
    email: 'jonas@dltech.dev',
    initials: 'JW',
    role: EWorkspaceRole.Member,
    joined: 'Jul 8, 2026',
    lastActive: '5d ago',
  },
]

export const PENDING_INVITES: PendingInvite[] = [
  {
    id: 'inv1',
    email: 'lena@dltech.dev',
    role: EWorkspaceRole.Member,
    invitedBy: 'Dennis Lysenko',
    expiresInDays: 2,
  },
  {
    id: 'inv2',
    email: 'sam@acme.dev',
    role: EWorkspaceRole.Admin,
    invitedBy: 'Maya Okafor',
    expiresInDays: 0,
  },
]

export const INVITE_EXPIRY_DAYS = 2

export const WORKSPACE_SECRETS: LibrarySecret[] = [
  {
    id: 'w1',
    key: 'ANTHROPIC_API_KEY',
    kind: ESecretKind.Secret,
    value: 'sk-ant-api03-Qm7Ld2xVn9tKc4wH8bRe',
    updated: '2w ago',
    scope: ESecretsScope.Workspace,
  },
  {
    id: 'w2',
    key: 'NPM_TOKEN',
    kind: ESecretKind.Secret,
    value: 'npm_Zt3Wb8nYs1qD',
    updated: '2mo ago',
    scope: ESecretsScope.Workspace,
  },
  {
    id: 'w3',
    key: 'SENTRY_AUTH_TOKEN',
    kind: ESecretKind.Secret,
    value: 'sntrys_eyJpYXQiOjE3MTk',
    updated: '5w ago',
    scope: ESecretsScope.Workspace,
  },
  {
    id: 'w4',
    key: 'ATLAS_REGION',
    kind: ESecretKind.EnvVar,
    value: 'iad1',
    updated: '2mo ago',
    scope: ESecretsScope.Workspace,
  },
  {
    id: 'w5',
    key: 'LOG_LEVEL',
    kind: ESecretKind.EnvVar,
    value: 'info',
    updated: '3w ago',
    scope: ESecretsScope.Workspace,
  },
]

export const WORKSPACE_VERCEL_VIEW: WorkspaceVercelView = {
  configured: true,
  tokenHint: 'vcp_…q9Zt',
  teamId: 'team_8f2KdLmQ1xA',
  vercelProjectId: 'prj_Hs4TnV0cRb7',
  updatedAt: '2026-10-12T14:00:00.000Z',
}

export const WORKSPACE_VERCEL_STATUS = 'Configured · updated 2w ago'

function sharedOauth({
  name,
  url,
  connection,
}: Pick<McpServer, 'name' | 'connection'> & { url: string }): McpServer {
  return {
    name,
    scope: EMcpScope.Workspace,
    enabled: true,
    spec: {
      transport: EMcpTransport.Http,
      url,
      auth: { kind: EMcpAuth.OAuth, clientId: '', clientSecret: '' },
      headers: [],
    },
    connection,
  }
}

export const WORKSPACE_MCP_SERVERS: McpServer[] = [
  sharedOauth({
    name: 'linear',
    url: 'https://mcp.linear.app/mcp',
    connection: { state: EMcpOAuthState.Connected, account: MCP_ACCOUNT },
  }),
  sharedOauth({
    name: 'sentry',
    url: 'https://mcp.sentry.dev/mcp',
    connection: { state: EMcpOAuthState.SignInRequired },
  }),
  {
    name: 'context7',
    scope: EMcpScope.Workspace,
    enabled: true,
    spec: {
      transport: EMcpTransport.Http,
      url: 'https://mcp.context7.com/mcp',
      auth: { kind: EMcpAuth.None },
      headers: [],
    },
    connection: null,
  },
  {
    name: 'postgres',
    scope: EMcpScope.Workspace,
    enabled: false,
    spec: {
      transport: EMcpTransport.Stdio,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: [{ key: 'DATABASE_URL', value: '${DATABASE_URL}', secret: false }],
    },
    connection: null,
  },
]
