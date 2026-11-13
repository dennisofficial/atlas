import type { SessionModelChoice } from '@dltech/atlas-protocol'

import { existingSelectionOf, type ModelSelection } from '@/features/threads/data/model-selection'

export type { SessionModelChoice }

export const sessionModelOf = (
  row: { model?: SessionModelChoice | null | undefined } | null | undefined,
): SessionModelChoice | null => row?.model ?? null

export const sessionSelectionOf = (
  choice: SessionModelChoice | null | undefined,
): ModelSelection =>
  choice === undefined || choice === null
    ? existingSelectionOf(undefined)
    : existingSelectionOf({
        ref: choice.ref,
        effort: choice.effort ?? '',
        fast: choice.fast,
      })
