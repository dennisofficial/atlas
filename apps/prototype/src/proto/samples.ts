export interface ProtoSample {
  label: string
  path: string
}

export const PROTO_SAMPLES: Record<string, ProtoSample[]> = {
  '/invite/[id]': [{ label: 'Invitation', path: '/invite/inv-demo' }],
  '/threads/[threadId]': [
    { label: 'Session', path: '/threads/thr-ui-rebase' },
    { label: 'Other thread', path: '/threads/thr-snapshots' },
    { label: 'Teammate', path: '/threads/tm-gutter-tokens' },
  ],
  '/settings/[page]': [
    { label: 'Account', path: '/settings/account' },
    { label: 'Providers', path: '/settings/providers' },
    { label: 'GitHub', path: '/settings/github' },
    { label: 'Sandbox', path: '/settings/sandbox' },
    { label: 'Secrets & Env Vars', path: '/settings/secrets' },
    { label: 'MCP', path: '/settings/mcp' },
    { label: 'Instructions', path: '/settings/instructions' },
    { label: 'Memory', path: '/settings/memory' },
    { label: 'Models & Effort', path: '/settings/models-effort' },
    { label: 'Appearance', path: '/settings/appearance' },
    { label: 'Notifications', path: '/settings/notifications' },
    { label: 'Devices & Sessions', path: '/settings/security' },
  ],
  '/projects/[projectId]/settings/[section]': [
    { label: 'Overview', path: '/projects/rs-crm/settings/overview' },
    { label: 'Sandbox', path: '/projects/rs-crm/settings/sandbox' },
    { label: 'Secrets & Env Vars', path: '/projects/rs-crm/settings/secrets' },
    { label: 'MCP', path: '/projects/rs-crm/settings/mcp' },
  ],
}
