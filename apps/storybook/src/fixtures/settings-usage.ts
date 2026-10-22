export type SandboxRow = {
  id: string
  title: string
  repo: string
  size: string
  last24h: string
  cost: string
  runningFor?: string
  pausedAgo?: string
}

export const RUNNING_SANDBOXES: SandboxRow[] = [
  {
    id: 'sb-41',
    title: 'fix flaky ws reconnect',
    repo: 'dltech/atlas',
    size: 'standard-4',
    last24h: '6h13m',
    cost: '$2.06',
    runningFor: '5m',
  },
  {
    id: 'sb-42',
    title: 'rs-crm: ticket PDF export',
    repo: 'dltech/rs-crm',
    size: 'standard-2',
    last24h: '3h02m',
    cost: '$0.77',
    runningFor: '1h 42m',
  },
  {
    id: 'sb-43',
    title: 'storybook settings mockups',
    repo: 'dltech/atlas',
    size: 'standard-8',
    last24h: '2h40m',
    cost: '$1.88',
    runningFor: '38m',
  },
]

export const PAUSED_SANDBOXES: SandboxRow[] = [
  {
    id: 'sb-37',
    title: 'triage nightly canary failure',
    repo: 'dltech/comp-v3',
    size: 'standard-2',
    last24h: '1h11m',
    cost: '$0.28',
    pausedAgo: '12m ago',
  },
  {
    id: 'sb-35',
    title: 'draft migration for pending invites',
    repo: 'dltech/rs-crm',
    size: 'standard-4',
    last24h: '4h27m',
    cost: '$1.49',
    pausedAgo: '2h ago',
  },
]
