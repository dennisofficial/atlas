import type { ControlTx } from './port'

export const archiveIn = async (params: {
  tx: ControlTx
  sessionId: string
  archivedAt: string | null
}): Promise<void> => {
  const { tx, ...change } = params
  if (!(await tx.setSessionArchived(change))) {
    throw new Error(`unknown session ${params.sessionId}`)
  }
  await tx.announce({ sessionId: params.sessionId })
}

export const titleUntitledIn = async (params: {
  tx: ControlTx
  sessionId: string
  title: string
}): Promise<boolean> => {
  const { tx, ...change } = params
  const titled = await tx.setSessionTitleIfUntitled(change)
  if (titled) await tx.announce({ sessionId: params.sessionId })
  return titled
}
