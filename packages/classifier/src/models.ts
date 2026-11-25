import { EAuthProvider, parseRef, refKey, type ModelRef } from '@dltech/atlas-core'

export enum EClassifierTransport {
  Jev = 'jev',
  OpenAiDecisions = 'openai-decisions',
}

export type DecisionModel = {
  ref: ModelRef
  label: string
  transport: EClassifierTransport
  endpoint: string
  model: string
  provider: EAuthProvider
}

export const DECISION_MODELS: readonly DecisionModel[] = [
  {
    ref: { providerId: 'typesafe', modelId: 'jev-latest' },
    label: 'Jev, direct (TypeSafe)',
    transport: EClassifierTransport.Jev,
    endpoint: 'https://api.typesafe.ai',
    model: 'jev-latest',
    provider: EAuthProvider.Typesafe,
  },
  {
    ref: { providerId: 'gateway', modelId: 'typesafe-ai/jev' },
    label: 'Jev through Vercel AI Gateway',
    transport: EClassifierTransport.Jev,
    endpoint: 'https://ai-gateway.vercel.sh/typesafe',
    model: 'typesafe-ai/jev-1.14.0',
    provider: EAuthProvider.Gateway,
  },
  {
    ref: { providerId: 'openai', modelId: 'gpt-6-luna' },
    label: 'OpenAI Decisions',
    transport: EClassifierTransport.OpenAiDecisions,
    endpoint: 'https://api.openai.com/v1/decisions',
    model: 'gpt-6-luna',
    provider: EAuthProvider.OpenAI,
  },
]

export function decisionModelOf(stored: string): DecisionModel | undefined {
  const ref = parseRef(stored)
  if (ref === undefined) return undefined
  return DECISION_MODELS.find(
    (model) => model.ref.providerId === ref.providerId && model.ref.modelId === ref.modelId,
  )
}

export const refKeyOf = (model: DecisionModel): string => refKey(model.ref)
