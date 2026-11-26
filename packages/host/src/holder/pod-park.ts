import type { ControlPlane } from '@dltech/atlas-control'

export const podParkedOf = async (args: {
  plane: ControlPlane
  sessionId: string
}): Promise<boolean> => {
  const row = await args.plane.readSession({ sessionId: args.sessionId })
  return row !== undefined && row.podParkedAt !== null
}
