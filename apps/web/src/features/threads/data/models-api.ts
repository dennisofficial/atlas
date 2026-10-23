import { modelsResponseSchema, type ModelsResponse } from '@dltech/atlas-wire/web'

import { cloudJson, EHttpMethod } from '@/lib/cloud-api'

import type { AccountSummary, ModelsSource } from './model-options'

export function fetchModels(): Promise<ModelsResponse> {
  return cloudJson({ method: EHttpMethod.Get, path: '/v1/models', schema: modelsResponseSchema })
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
