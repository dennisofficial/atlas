import { EFinishReason, type V2Body } from '@dltech/atlas-core'

import type { PrStateRow } from '../../port'

export const reading = (tokens: number): V2Body => ({
  type: 'assistant-said',
  parts: [],
  finish: EFinishReason.Stop,
  usage: { inputTokens: tokens, outputTokens: 5, providerId: 'openai', modelId: 'gpt-5' },
})

export const linked = (number: number): V2Body => ({
  type: 'pull-request-linked',
  number,
  url: `https://github.com/Acme/App/pull/${number}`,
  repo: 'github.com/Acme/App',
  branch: 'feat',
})

export const branches: V2Body = {
  type: 'branches-observed',
  repo: '/work/app',
  head: 'feat',
  base: 'main',
  branches: [
    { name: 'main', sha: 'a1' },
    { name: 'feat', sha: 'b2' },
  ],
  worktrees: [],
  remotes: [{ name: 'origin', url: 'git@github.com:Acme/App.git' }],
}

export const forkBranches: V2Body = {
  ...branches,
  repo: '/work/fork',
  remotes: [{ name: 'origin', url: 'https://github.com/Fork/App.git' }],
}

export const prStateOf = (args: {
  number: number
  state: string
  updatedAt: string
  headRepoFullName?: string
  closedAt?: string
  mergedAt?: string
}): PrStateRow => ({
  repo: 'acme/app',
  number: args.number,
  title: `PR ${args.number}`,
  state: args.state,
  headSha: 'b2',
  checksRunning: 0,
  checksPassed: 2,
  checksFailed: 0,
  checksExpected: 0,
  mergeable: true,
  updatedAt: args.updatedAt,
  closedAt: args.closedAt ?? null,
  mergedAt: args.mergedAt ?? null,
  headRepoFullName: args.headRepoFullName ?? 'acme/app',
  headBranch: 'feat',
})
