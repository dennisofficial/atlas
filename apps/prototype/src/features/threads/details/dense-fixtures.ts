import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

export const DENSE_HEAD = {
  title: 'Continue Workflows feature PR 794',
  turns: 19,
  cost: '$52.97',
  tokensIn: '8.50m',
  tokensOut: '763.6k',
  cache: '152.76m',
}

export const DENSE_POD = {
  vcpus: 8,
  memory: '16 GB',
  region: 'iad1',
  serve: 'atlas-serve 1.94.2',
}

export const DENSE_PR = {
  number: 794,
  title: 'Workflows: automations foundation',
  branch: 'dennis/automations-foundation',
  passing: 31,
  failing: 4,
  running: 0,
  watched: false,
  url: 'https://github.com/dennisofficial/atlas/pull/794',
}

export interface DensePullRequest {
  number: number
  title: string
  branch: string
  merged: boolean
  passing: number
  failing: number
  running: number
  watched: boolean
  url: string
}

export const DENSE_BRANCH = 'dennis/automations-foundation'

export const DENSE_PRS: DensePullRequest[] = [
  { ...DENSE_PR, merged: false },
  {
    number: 781,
    title: 'Workflows: trigger seam',
    branch: 'dennis/workflows-trigger-seam',
    merged: true,
    passing: 28,
    failing: 0,
    running: 0,
    watched: false,
    url: 'https://github.com/dennisofficial/atlas/pull/781',
  },
]

export enum EDenseServiceState {
  Running = 'running',
  Starting = 'starting',
  Stopped = 'stopped',
  Failed = 'failed',
}

export interface DenseService {
  id: string
  name: string
  state: EDenseServiceState
  description?: string
  port?: number
  uptime?: string
  adhoc?: boolean
  hasUrl: boolean
}

export const DENSE_SERVICES: DenseService[] = [
  {
    id: 's-infra',
    name: 'infra',
    state: EDenseServiceState.Running,
    port: 5433,
    uptime: '2h 14m',
    hasUrl: true,
  },
  {
    id: 's-api',
    name: 'api',
    state: EDenseServiceState.Running,
    port: 3400,
    uptime: '2h 13m',
    hasUrl: true,
  },
  {
    id: 's-admin-api',
    name: 'admin-api',
    state: EDenseServiceState.Stopped,
    port: 3401,
    hasUrl: true,
  },
  {
    id: 's-web',
    name: 'web',
    state: EDenseServiceState.Running,
    description: 'Web app',
    port: 3000,
    uptime: '2h 13m',
    hasUrl: true,
  },
  {
    id: 's-admin',
    name: 'admin',
    state: EDenseServiceState.Running,
    description: 'Admin console',
    port: 3002,
    uptime: '1h 51m',
    hasUrl: true,
  },
  {
    id: 's-agents',
    name: 'agents',
    state: EDenseServiceState.Stopped,
    hasUrl: true,
  },
  {
    id: 's-trigger',
    name: 'trigger',
    state: EDenseServiceState.Running,
    uptime: '2h 12m',
    hasUrl: true,
  },
  {
    id: 's-storybook',
    name: 'storybook',
    state: EDenseServiceState.Stopped,
    port: 6006,
    hasUrl: true,
  },
  {
    id: 's-docs',
    name: 'docs',
    state: EDenseServiceState.Failed,
    port: 3300,
    hasUrl: true,
  },
  {
    id: 's-evals',
    name: 'evals',
    state: EDenseServiceState.Stopped,
    hasUrl: true,
  },
  {
    id: 's-pass',
    name: 'Public pass-through to local API 3002',
    state: EDenseServiceState.Running,
    uptime: '1h 5m',
    adhoc: true,
    hasUrl: false,
  },
]

export interface DenseAgent {
  id: string
  title: string
  model: string
  display: EAgentDisplay
  elapsed: string
  tokens: string
}

export const DENSE_SUBAGENTS: DenseAgent[] = [
  {
    id: 'a-1',
    title: '06 cron review',
    model: 'glm-5.3',
    display: EAgentDisplay.Running,
    elapsed: '2m 58s',
    tokens: '125.3k',
  },
  {
    id: 'a-2',
    title: 'fix local event',
    model: 'Claude Sonnet 5.5',
    display: EAgentDisplay.Running,
    elapsed: '7m 31s',
    tokens: '70.1k',
  },
  {
    id: 'a-3',
    title: 'live check 05a+realtime',
    model: 'kimi-k3-fast',
    display: EAgentDisplay.Done,
    elapsed: '4m 02s',
    tokens: '98.6k',
  },
  {
    id: 'a-4',
    title: '05 event router',
    model: 'Claude Sonnet 5.5',
    display: EAgentDisplay.Done,
    elapsed: '11m 40s',
    tokens: '212.9k',
  },
  {
    id: 'a-5',
    title: 'review 04 schema',
    model: 'gpt-5.5',
    display: EAgentDisplay.Failed,
    elapsed: '3m 10s',
    tokens: '41.2k',
  },
  {
    id: 'a-6',
    title: '04 workflow schema',
    model: 'Claude Sonnet 5.5',
    display: EAgentDisplay.Done,
    elapsed: '9m 12s',
    tokens: '188.0k',
  },
  {
    id: 'a-7',
    title: 'audit trigger jobs',
    model: 'glm-5.3',
    display: EAgentDisplay.Done,
    elapsed: '2m 21s',
    tokens: '33.4k',
  },
  {
    id: 'a-8',
    title: '03 action registry',
    model: 'Claude Sonnet 5.5',
    display: EAgentDisplay.Done,
    elapsed: '14m 05s',
    tokens: '240.7k',
  },
  {
    id: 'a-9',
    title: 'map cron call sites',
    model: 'kimi-k3-fast',
    display: EAgentDisplay.Done,
    elapsed: '1m 48s',
    tokens: '22.0k',
  },
  {
    id: 'a-10',
    title: '02 run store',
    model: 'Claude Sonnet 5.5',
    display: EAgentDisplay.Done,
    elapsed: '8m 33s',
    tokens: '150.1k',
  },
  {
    id: 'a-11',
    title: 'review 02',
    model: 'gpt-5.5',
    display: EAgentDisplay.Done,
    elapsed: '3m 59s',
    tokens: '61.8k',
  },
  {
    id: 'a-12',
    title: '01 trigger seam',
    model: 'Claude Sonnet 5.5',
    display: EAgentDisplay.Done,
    elapsed: '10m 17s',
    tokens: '197.3k',
  },
  {
    id: 'a-13',
    title: 'explore automations',
    model: 'glm-5.3',
    display: EAgentDisplay.Done,
    elapsed: '2m 40s',
    tokens: '45.5k',
  },
  {
    id: 'a-14',
    title: 'research cron libs',
    model: 'kimi-k3-fast',
    display: EAgentDisplay.Done,
    elapsed: '5m 11s',
    tokens: '72.9k',
  },
]

export const DENSE_CONTEXT = {
  folders: ['artifacts', 'evidence', 'handoffs', 'research', 'sections'],
  files: ['decisions.md', 'plan.md', 'WAKEUP.md'],
}
