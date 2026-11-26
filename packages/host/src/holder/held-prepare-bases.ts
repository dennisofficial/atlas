import type { RecordEventBody } from '@dltech/atlas-core'

import type { CapturedBase } from './ports'

export const BASE_FACT_KIND = 'base'

export const baseFactKeyOf = (repoPath: string): string => `base:${repoPath}`

export const baseFactDraftsOf = (bases: readonly CapturedBase[] | undefined): RecordEventBody[] =>
  (bases ?? []).map(({ repoPath, base }) => ({
    type: 'fact-recorded',
    key: baseFactKeyOf(repoPath),
    kind: BASE_FACT_KIND,
    value: base,
  }))
