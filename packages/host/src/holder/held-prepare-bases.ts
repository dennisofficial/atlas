import type { V2Body } from '@dltech/atlas-core'

import type { CapturedBase } from './ports'

export const baseFactKeyOf = (repoPath: string): string => `base:${repoPath}`

export const baseFactDraftsOf = (bases: readonly CapturedBase[] | undefined): V2Body[] =>
  (bases ?? []).map(({ repoPath, base }) => ({
    type: 'fact-recorded',
    key: baseFactKeyOf(repoPath),
    kind: 'base',
    value: base,
  }))
