import { api, cloudCall } from '@/lib/api-client'

export const putSecret = (args: {
  projectId: string
  name: string
  value: string
}): Promise<void> => cloudCall(api.projectResources.setSecret.mutate(args))
