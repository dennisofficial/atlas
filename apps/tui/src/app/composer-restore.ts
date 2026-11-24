import type { Attachment } from '@dltech/atlas-core'

import type { DraftTokens } from '../ui/hooks/use-draft-tokens'
import type { SessionAttachments } from './use-session-attachments'

export type ComposerRestore = (args: {
  text: string
  attachments: readonly Attachment[]
  reason: string | undefined
}) => void

export const composerRestoreOf = (args: {
  tokens: Pick<DraftTokens, 'restore'>
  attachments: Pick<SessionAttachments, 'restore'>
  onProblem: (reason: string) => void
}): ComposerRestore => {
  return (restored) => {
    args.tokens.restore({ text: restored.text, images: [] })
    args.attachments.restore(restored.attachments)
    if (restored.reason !== undefined) args.onProblem(restored.reason)
  }
}
