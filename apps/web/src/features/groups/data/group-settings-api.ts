import { api, cloudCall } from '@/lib/api-client'

export const patchGroupSettings = (args: {
  groupId: string
  values: Record<string, string | null>
}): Promise<void> => cloudCall(api.groupResources.patchSettings.mutate(args))
