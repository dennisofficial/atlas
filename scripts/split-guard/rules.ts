import type { SplitRule } from './scan'

export const SPLIT_RULES: readonly SplitRule[] = [
  {
    name: 'v2 must not depend on v1',
    roots: [
      'packages/agent',
      'packages/host',
      'packages/control',
      'packages/protocol',
      'apps/agent-host',
      'apps/daemon',
    ],
    forbidden: [
      '@dltech/atlas-harness',
      '@dltech/atlas-wire',
      '@dltech/atlas-serve',
      '@dltech/atlas-agent-v1',
    ],
  },
  {
    name: 'v1 must not depend on v2',
    roots: ['packages/harness', 'packages/agent-v1', 'apps/serve'],
    forbidden: ['@dltech/atlas-agent', '@dltech/atlas-host', '@dltech/atlas-control'],
  },
]
