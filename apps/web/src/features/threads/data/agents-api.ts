import { api, cloudCall } from '@/lib/api-client'

export const fetchSpawned = (threadId: string) => cloudCall(api.threads.spawned.query({ threadId }))
