export interface ProtoSample {
  label: string
  path: string
}

export const PROTO_SAMPLES: Record<string, ProtoSample[]> = {
  '/artifacts/[slug]': [
    { label: 'Ready', path: '/artifacts/atlas-landing' },
    { label: 'Building', path: '/artifacts/launch-deck' },
    { label: 'Failed', path: '/artifacts/pricing-table' },
  ],
  '/threads/[threadId]': [
    { label: 'Session', path: '/threads/thr-ui-rebase' },
    { label: 'Other thread', path: '/threads/thr-snapshots' },
    { label: 'Teammate', path: '/threads/tm-gutter-tokens' },
  ],
  '/sessions/[sessionId]': [{ label: 'v2 session', path: '/sessions/thr-ui-rebase' }],
  '/routines/[routineId]': [
    { label: 'Running', path: '/routines/rte-dead-code' },
    { label: 'Skipped', path: '/routines/rte-dep-audit' },
    { label: 'Paused', path: '/routines/rte-inbox-triage' },
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
  '/settings/skills/[skillId]': [
    { label: 'code-review', path: '/settings/skills/code-review' },
    { label: 'commit', path: '/settings/skills/commit' },
  ],
  '/projects/[projectId]/settings/skills': [
    { label: 'atlas', path: '/projects/atlas/settings/skills' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/skills' },
  ],
  '/projects/[projectId]/settings/skills/[skillId]': [
    { label: 'atlas', path: '/projects/atlas/settings/skills/code-review' },
    { label: 'rs-crm', path: '/projects/rs-crm/settings/skills/commit' },
  ],
}
