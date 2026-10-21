import { EUsageModel, dayLabel } from './settings-usage'

export type ThreadSpend = {
  id: string
  title: string
  repo: string
  model: EUsageModel
  spend: number
  tokensMillions: number
  minutesAgo: number
}

export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

export const RECENT_THREAD_SPEND: ThreadSpend[] = [
  {
    id: 't-9f31',
    title: 'fix flaky ws reconnect',
    repo: 'dltech/atlas',
    model: EUsageModel.Opus,
    spend: 12.84,
    tokensMillions: 2.9,
    minutesAgo: 6,
  },
  {
    id: 't-9e07',
    title: 'rs-crm: ticket PDF export',
    repo: 'dltech/rs-crm',
    model: EUsageModel.Sonnet,
    spend: 3.41,
    tokensMillions: 1.2,
    minutesAgo: 47,
  },
  {
    id: 't-9d88',
    title: 'review PR #1270 lifecycle rebuild',
    repo: 'dltech/atlas',
    model: EUsageModel.Gpt5,
    spend: 2.17,
    tokensMillions: 0.7,
    minutesAgo: 95,
  },
  {
    id: 't-9c52',
    title: 'storybook settings mockups',
    repo: 'dltech/atlas',
    model: EUsageModel.Opus,
    spend: 18.6,
    tokensMillions: 4.1,
    minutesAgo: 180,
  },
  {
    id: 't-9b14',
    title: 'rename sandbox snapshot flags',
    repo: 'dltech/atlas',
    model: EUsageModel.Gpt5Mini,
    spend: 0.26,
    tokensMillions: 0.4,
    minutesAgo: 305,
  },
  {
    id: 't-9a60',
    title: 'triage nightly canary failure',
    repo: 'dltech/comp-v3',
    model: EUsageModel.Sonnet,
    spend: 1.93,
    tokensMillions: 0.9,
    minutesAgo: 480,
  },
  {
    id: 't-99f2',
    title: 'draft migration for pending invites',
    repo: 'dltech/rs-crm',
    model: EUsageModel.Opus,
    spend: 7.05,
    tokensMillions: 1.6,
    minutesAgo: 640,
  },
]

export const ALL_THREAD_SPEND: ThreadSpend[] = [
  ...RECENT_THREAD_SPEND,
  {
    id: 't-98a1',
    title: 'tui: shimmer ticker perf pass',
    repo: 'dltech/atlas',
    model: EUsageModel.Opus,
    spend: 24.7,
    tokensMillions: 5.8,
    minutesAgo: 1_020,
  },
  {
    id: 't-9733',
    title: 'serve: reconnect backoff tests',
    repo: 'dltech/atlas',
    model: EUsageModel.Sonnet,
    spend: 4.22,
    tokensMillions: 1.5,
    minutesAgo: 1_700,
  },
  {
    id: 't-9610',
    title: 'explain bun isolated linker',
    repo: 'dltech/atlas',
    model: EUsageModel.Gpt5Mini,
    spend: 0.09,
    tokensMillions: 0.1,
    minutesAgo: 2_900,
  },
  {
    id: 't-9544',
    title: 'web: cloud thread list virtualization',
    repo: 'dltech/atlas',
    model: EUsageModel.Opus,
    spend: 31.15,
    tokensMillions: 7.2,
    minutesAgo: 4_300,
  },
]

export type DailySpend = {
  label: string
  byModel: { model: EUsageModel; spend: number }[]
}

const DAILY_COSTS: [number, number, number, number][] = [
  [188.4, 38.2, 14.6, 3.4],
  [141.2, 41.5, 17.3, 3.9],
  [96.7, 29.1, 11.2, 2.6],
  [152.9, 44.6, 16.4, 3.7],
  [118.1, 36.8, 13.9, 3.1],
  [74.3, 28.4, 10.8, 2.4],
  [130.7, 42.8, 13.9, 3.7],
]

export const DAILY_SPEND: DailySpend[] = DAILY_COSTS.map(([opus, sonnet, gpt5, mini], index) => ({
  label: dayLabel(index),
  byModel: [
    { model: EUsageModel.Opus, spend: opus },
    { model: EUsageModel.Sonnet, spend: sonnet },
    { model: EUsageModel.Gpt5, spend: gpt5 },
    { model: EUsageModel.Gpt5Mini, spend: mini },
  ],
}))

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
