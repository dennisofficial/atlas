import { api, cloudCall } from '@/lib/api-client'

export type GroupInstructionsDoc = { content: string; updatedAt: string | null }

export function fetchGroupInstructions(groupId: string): Promise<GroupInstructionsDoc> {
  return cloudCall(api.groupResources.instructions.query({ groupId }))
}

export async function saveGroupInstructions(args: {
  groupId: string
  content: string
}): Promise<void> {
  await cloudCall(api.groupResources.saveInstructions.mutate(args))
}
