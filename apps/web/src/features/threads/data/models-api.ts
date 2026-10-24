import type { ModelsResponse } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import type { AccountSummary, ModelsSource } from './model-options'

export function fetchModels(): Promise<ModelsResponse> {
  return cloudCall(api.models.list.query())
}

export async function loadModelsSource(args: {
  loadModels: () => Promise<ModelsResponse>
  loadAccounts: () => Promise<readonly AccountSummary[]>
}): Promise<ModelsSource> {
  try {
    return { kind: 'live', response: await args.loadModels() }
  } catch {
    return { kind: 'accounts', accounts: await args.loadAccounts() }
  }
}
