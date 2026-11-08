import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export type RenameApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export const renameSession = async ({
  api,
  sessionId,
  name,
}: {
  api: RenameApi
  sessionId: string
  name: string
}): Promise<void> => {
  await api.command({ sessionId, name: 'rename', args: { name } })
}
