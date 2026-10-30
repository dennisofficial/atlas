export interface ProtoSample {
  label: string
  path: string
}

export const PROTO_SAMPLES: Record<string, ProtoSample[]> = {
  '/threads/[threadId]': [
    { label: 'Session', path: '/threads/thr-ui-rebase' },
    { label: 'Other thread', path: '/threads/thr-snapshots' },
    { label: 'Teammate', path: '/threads/tm-gutter-tokens' },
  ],
  '/projects/[projectId]/settings/overview': [
    { label: 'atlas', path: '/projects/atlas/settings/overview' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/overview' },
  ],
  '/projects/[projectId]/settings/sandbox': [
    { label: 'atlas', path: '/projects/atlas/settings/sandbox' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/sandbox' },
  ],
  '/projects/[projectId]/settings/secrets': [
    { label: 'atlas', path: '/projects/atlas/settings/secrets' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/secrets' },
  ],
  '/projects/[projectId]/settings/files': [
    { label: 'atlas', path: '/projects/atlas/settings/files' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/files' },
  ],
  '/projects/[projectId]/settings/mcp': [
    { label: 'atlas', path: '/projects/atlas/settings/mcp' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/mcp' },
  ],
  '/projects/[projectId]/settings/pull-requests': [
    { label: 'atlas', path: '/projects/atlas/settings/pull-requests' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/pull-requests' },
  ],
}
