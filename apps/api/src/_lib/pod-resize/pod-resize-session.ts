import { NotFoundException } from '@nestjs/common'
import type { ControlPlane, ControlSessionRow } from '@dltech/atlas-control'

export const sessionOf = async (args: {
  plane: ControlPlane
  sessionId: string
}): Promise<ControlSessionRow> => {
  const session = await args.plane.readSession({ sessionId: args.sessionId })
  if (session === undefined || session.deletedAt !== null) {
    throw new NotFoundException('session not found')
  }
  return session
}

export const podSessionIdOf = (session: ControlSessionRow): string =>
  session.podSessionId ?? session.sessionId
