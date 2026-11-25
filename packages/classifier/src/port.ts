import {
  ClassifierPort,
  EClassifierFault,
  type ClassifierOutcome,
  type ClassifierQuestion,
  type ClassifierStatus,
} from '@dltech/atlas-core'

import { EClassifierOffReason, type ClassifierAvailability } from './availability'
import { JevClassifier } from './jev'
import { EClassifierTransport } from './models'
import { OpenAiClassifier } from './openai'

export type ClassifierConfig =
  | { on: true; transport: EClassifierTransport; endpoint: string; model: string; apiKey: string }
  | { on: false; reason: string }

export type ClassifierDeps = {
  fetch?: typeof fetch | undefined
  timeoutMs?: number | undefined
}

class OffClassifier extends ClassifierPort {
  constructor(private readonly reason: string) {
    super()
  }

  async classify(args: {
    state: string
    questions: Record<string, ClassifierQuestion>
    signal: AbortSignal
  }): Promise<ClassifierOutcome> {
    return { ok: false, fault: EClassifierFault.Unavailable, detail: this.reason }
  }
}

export function classifierOf(config: ClassifierConfig, deps?: ClassifierDeps): ClassifierPort {
  if (!config.on) return new OffClassifier(config.reason)
  const common = {
    endpoint: config.endpoint,
    model: config.model,
    apiKey: config.apiKey,
    ...deps,
  }
  if (config.transport === EClassifierTransport.OpenAiDecisions) return new OpenAiClassifier(common)
  return new JevClassifier(common)
}

export const classifierStatusOf = (config: ClassifierConfig): ClassifierStatus =>
  config.on
    ? { on: true, model: config.model, provider: config.transport }
    : { on: false, reason: config.reason }

export function classifierConfigFrom(availability: ClassifierAvailability): ClassifierConfig {
  if (!availability.on) return { on: false, reason: availability.reason }
  const { model, credential } = availability
  if (credential.apiKey === undefined) {
    return { on: false, reason: EClassifierOffReason.NotConnected }
  }
  return {
    on: true,
    transport: model.transport,
    endpoint: model.endpoint,
    model: model.model,
    apiKey: credential.apiKey,
  }
}
