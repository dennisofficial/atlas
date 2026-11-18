import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

import { ETodoStatus, type TodoTask } from '../../details/details-model'
import { EPrState } from '../../pull-request-model'

export const PLAN_TASKS: TodoTask[] = [
  { id: 'p-1', text: 'Read the v2 pane brief', status: ETodoStatus.Done },
  { id: 'p-2', text: 'Map tokens onto theme variables', status: ETodoStatus.Done },
  { id: 'p-3', text: 'Rebuild the details sections', status: ETodoStatus.Done },
  { id: 'p-4', text: 'Write the changes variants', status: ETodoStatus.Done },
  {
    id: 'p-5',
    text: 'Build the details variants',
    activeForm: 'Building the details variants',
    status: ETodoStatus.Running,
  },
  { id: 'p-6', text: 'Screenshot each variant', status: ETodoStatus.Pending },
  { id: 'p-7', text: 'Run typecheck and biome', status: ETodoStatus.Pending },
  { id: 'p-8', text: 'Hand the three variants to Dennis', status: ETodoStatus.Pending },
]

export function planCountLabel(tasks: TodoTask[]): string {
  const done = tasks.filter((task) => task.status === ETodoStatus.Done).length
  return `${done}/${tasks.length}`
}

export const PANE_BRANCH = 'dennis/v2-pane-prototypes'

export interface PanePr {
  number: number
  title: string
  branch: string
  state: EPrState
  passing: number
  failing: number
  running: number
  review: string
  watched: boolean
  url: string
}

const REPO_URL = 'https://github.com/dennisofficial/atlas/pull'

export const PANE_PRS: PanePr[] = [
  {
    number: 1469,
    title: 'Rebase ui on shadcn base-nova',
    branch: 'dennis/shadcn-ui-storybook',
    state: EPrState.Open,
    passing: 9,
    failing: 0,
    running: 3,
    review: '1 approval · 1 requested',
    watched: true,
    url: `${REPO_URL}/1469`,
  },
  {
    number: 1472,
    title: 'Port web header to base-nova',
    branch: 'dennis/web-header-port',
    state: EPrState.Draft,
    passing: 10,
    failing: 1,
    running: 0,
    review: 'Changes requested by dennis',
    watched: false,
    url: `${REPO_URL}/1472`,
  },
  {
    number: 1467,
    title: 'Move tokens into the ui package',
    branch: 'dennis/ui-tokens',
    state: EPrState.Merged,
    passing: 12,
    failing: 0,
    running: 0,
    review: 'Approved · squashed into main',
    watched: false,
    url: `${REPO_URL}/1467`,
  },
]

export function prChecksLabelOf(pr: PanePr): string {
  if (pr.failing > 0) return `${pr.failing} failing`
  if (pr.running > 0) return `${pr.running} running`
  return `${pr.passing} passing`
}

export enum EServiceState {
  Running = 'running',
  Starting = 'starting',
  Stopped = 'stopped',
  Failed = 'failed',
}

export interface PaneService {
  id: string
  name: string
  state: EServiceState
  port?: number
  uptime?: string
  url?: string
}

export const SERVICE_STATE_LABEL: Record<EServiceState, string> = {
  [EServiceState.Running]: 'Running',
  [EServiceState.Starting]: 'Starting',
  [EServiceState.Stopped]: 'Stopped',
  [EServiceState.Failed]: 'Failed',
}

export const PANE_SERVICES: PaneService[] = [
  {
    id: 's-api',
    name: 'api',
    state: EServiceState.Running,
    port: 3400,
    uptime: '2h 13m',
    url: 'https://3400-thr-ui-rebase.atlas.run',
  },
  {
    id: 's-web',
    name: 'web',
    state: EServiceState.Running,
    port: 3000,
    uptime: '2h 13m',
    url: 'https://3000-thr-ui-rebase.atlas.run',
  },
  {
    id: 's-prototype',
    name: 'prototype',
    state: EServiceState.Running,
    port: 3100,
    uptime: '41m',
    url: 'https://3100-thr-ui-rebase.atlas.run',
  },
  {
    id: 's-docs',
    name: 'docs',
    state: EServiceState.Failed,
    port: 3300,
    url: 'https://3300-thr-ui-rebase.atlas.run',
  },
  {
    id: 's-storybook',
    name: 'storybook',
    state: EServiceState.Stopped,
    port: 6006,
    url: 'https://6006-thr-ui-rebase.atlas.run',
  },
  {
    id: 's-postgres',
    name: 'postgres',
    state: EServiceState.Running,
    port: 5433,
    uptime: '2h 14m',
  },
]

export interface PaneCrewMember {
  id: string
  name: string
  intent: string
  display: EAgentDisplay
  elapsed: string
  role: 'Sub-agent' | 'Teammate'
}

export const PANE_CREW: PaneCrewMember[] = [
  {
    id: 'c-1',
    name: 'reviewer',
    intent: 'Reviewing the pane variants for row alignment',
    display: EAgentDisplay.Running,
    elapsed: '7m 31s',
    role: 'Teammate',
  },
  {
    id: 'c-2',
    name: 'fix local event',
    intent: 'Reproduce the stale subscription row',
    display: EAgentDisplay.Running,
    elapsed: '2m 58s',
    role: 'Sub-agent',
  },
  {
    id: 'c-3',
    name: 'live check 05a',
    intent: 'Verify the preview ports answer after sleep',
    display: EAgentDisplay.WaitingForModel,
    elapsed: '4m 02s',
    role: 'Sub-agent',
  },
  {
    id: 'c-4',
    name: 'researcher',
    intent: 'Auditing Storybook a11y for the tabs',
    display: EAgentDisplay.Paused,
    elapsed: '12m 40s',
    role: 'Teammate',
  },
  {
    id: 'c-5',
    name: 'review 04 schema',
    intent: 'Second opinion on the workflow schema',
    display: EAgentDisplay.Failed,
    elapsed: '3m 10s',
    role: 'Sub-agent',
  },
  {
    id: 'c-6',
    name: 'map cron call sites',
    intent: 'Enumerate every schedule entry point',
    display: EAgentDisplay.Done,
    elapsed: '1m 48s',
    role: 'Sub-agent',
  },
]

export interface PaneContextFile {
  path: string
  kind: 'Instructions' | 'Memory' | 'Plan' | 'Section'
  detail: string
}

export const PANE_CONTEXT: PaneContextFile[] = [
  { path: 'ATLAS.md', kind: 'Instructions', detail: 'project · 38 lines' },
  { path: '.atlas/skills/prototype/UI.md', kind: 'Instructions', detail: 'skill · 113 lines' },
  { path: 'memory/feedback.md', kind: 'Memory', detail: 'prefers small PRs · 2 entries' },
  { path: 'memory/commit-style.md', kind: 'Memory', detail: 'lowercase imperatives · 1 entry' },
  { path: 'plans/details-pane.md', kind: 'Plan', detail: '21 lines · edited 2h ago' },
  { path: 'sections/07-pane-prototypes.md', kind: 'Section', detail: 'context · 14 lines' },
]
