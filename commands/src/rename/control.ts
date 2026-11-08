import type { ControlCommandHandler } from '@dltech/atlas-commands'

import { renameArgs } from './spec'

export type RenamePlane = {
  renameSession(params: { sessionId: string; title: string }): Promise<void>
}

export const renameHandler: ControlCommandHandler<RenamePlane, unknown> = async ({
  plane,
  sessionId,
  args,
}) => {
  const { name } = renameArgs.parse(args)
  await plane.renameSession({ sessionId, title: name })
}
