export type SandboxRow = {
  id: string
  title: string
  repo: string
  size: string
  last24h: string
  runningFor?: string
  pausedAgo?: string
}

export const RUNNING_SANDBOXES: SandboxRow[] = [
  {
    id: 'sb-41',
    title: 'fix flaky ws reconnect',
    repo: 'dltech/atlas',
    size: '4 vCPU',
    last24h: '6h13m',
    runningFor: '5m',
  },
  {
    id: 'sb-42',
    title: 'rs-crm: ticket PDF export',
    repo: 'dltech/rs-crm',
    size: '2 vCPU',
    last24h: '3h02m',
    runningFor: '1h 42m',
  },
  {
    id: 'sb-43',
    title: 'storybook settings mockups',
    repo: 'dltech/atlas',
    size: '8 vCPU',
    last24h: '2h40m',
    runningFor: '38m',
  },
]

export const PAUSED_SANDBOXES: SandboxRow[] = [
  {
    id: 'sb-37',
    title: 'triage nightly canary failure',
    repo: 'dltech/comp-v3',
    size: '2 vCPU',
    last24h: '1h11m',
    pausedAgo: '12m ago',
  },
  {
    id: 'sb-35',
    title: 'draft migration for pending invites',
    repo: 'dltech/rs-crm',
    size: '4 vCPU',
    last24h: '4h27m',
    pausedAgo: '2h ago',
  },
]
