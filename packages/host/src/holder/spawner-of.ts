import type { PromptSpawner } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

export const spawnerOf = async (args: {
  plane: ControlPlane
  sessionId: string
}): Promise<PromptSpawner | undefined> => {
  const row = await args.plane.readSession({ sessionId: args.sessionId })
  const spawnerId = row?.spawnedBySessionId ?? null
  if (spawnerId === null) return undefined
  const spawner = await args.plane.readSession({ sessionId: spawnerId })
  return spawner === undefined ? undefined : { sessionId: spawner.sessionId, title: spawner.title }
}
