import type { ControlCommandHandler } from '@dltech/atlas-commands'

import { REFUSAL_RENAME_NO_SUGGESTION, renameArgs } from './spec'

export type RenamePlane = {
  renameSession(params: { sessionId: string; title: string }): Promise<void>
}

export type SessionNameSuggester = (params: { sessionId: string }) => Promise<string | null>

export const renameHandlerOf =
  (deps: { suggestName: SessionNameSuggester }): ControlCommandHandler<RenamePlane, unknown> =>
  async ({ plane, sessionId, args }) => {
    const { name } = renameArgs.parse(args)
    const title = name ?? (await deps.suggestName({ sessionId }))
    if (title === null) throw new Error(REFUSAL_RENAME_NO_SUGGESTION)
    await plane.renameSession({ sessionId, title })
  }
