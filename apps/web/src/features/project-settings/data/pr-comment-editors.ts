import { PR_EDIT_MUTED_AUTHORS_FALLBACK, PR_EDIT_URGENT_AUTHORS_FALLBACK } from '@dltech/atlas-core'

export const MUTED_EDITORS_KEY = 'github.prEvents.editMutedAuthors'
export const URGENT_EDITORS_KEY = 'github.prEvents.editUrgentAuthors'

export type PrCommentEditors = { muted: string; urgent: string }

const textOf = ({ stored, fallback }: { stored: unknown; fallback: string }): string =>
  typeof stored === 'string' ? stored : fallback

export function prCommentEditorsOf(values: ReadonlyMap<string, unknown>): PrCommentEditors {
  return {
    muted: textOf({
      stored: values.get(MUTED_EDITORS_KEY),
      fallback: PR_EDIT_MUTED_AUTHORS_FALLBACK,
    }),
    urgent: textOf({
      stored: values.get(URGENT_EDITORS_KEY),
      fallback: PR_EDIT_URGENT_AUTHORS_FALLBACK,
    }),
  }
}

export function settingChangeOf({
  text,
  fallback,
}: {
  text: string
  fallback: string
}): string | null {
  const trimmed = text.trim()
  return trimmed === fallback ? null : trimmed
}

export function prCommentEditorChanges({
  draft,
}: {
  draft: PrCommentEditors
}): Record<string, string | null> {
  return {
    [MUTED_EDITORS_KEY]: settingChangeOf({
      text: draft.muted,
      fallback: PR_EDIT_MUTED_AUTHORS_FALLBACK,
    }),
    [URGENT_EDITORS_KEY]: settingChangeOf({
      text: draft.urgent,
      fallback: PR_EDIT_URGENT_AUTHORS_FALLBACK,
    }),
  }
}
