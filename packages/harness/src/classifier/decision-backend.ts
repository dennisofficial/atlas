import {
  decisionsEndpointOf,
  decisionsProviderIn,
  decisionsTokenNameOf,
  EDecisionsProtocol,
  type DecisionOutcome,
  type DecisionPort,
  type DecisionQuestion,
  type DecisionsEndpoint,
  type SecretsPort,
} from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'
import { JevDecisionClient } from './jev-client'
import { OpenAiDecisionClient } from './openai-decision-client'

type LiveEndpoint = { endpoint: DecisionsEndpoint; token: string | undefined }

export function liveDecisionsEndpoint(args: {
  settings: SettingsService
  secrets: SecretsPort
}): () => LiveEndpoint | null {
  return () => {
    const { resolution } = args.settings.snapshot()
    const provider = decisionsProviderIn({ resolution })
    const token = args.secrets.read(decisionsTokenNameOf({ provider }))
    const endpoint = decisionsEndpointOf({ resolution, token })
    return endpoint === null ? null : { endpoint, token }
  }
}

export class ProtocolDecisionClient implements DecisionPort {
  private readonly jev: JevDecisionClient
  private readonly openai: OpenAiDecisionClient

  constructor(private readonly live: () => LiveEndpoint | null) {
    this.jev = new JevDecisionClient({
      config: () => {
        const held = this.live()
        if (held === null || held.endpoint.protocol !== EDecisionsProtocol.Jev) return undefined
        return { baseUrl: held.endpoint.url, token: held.token }
      },
    })
    this.openai = new OpenAiDecisionClient({
      config: () => {
        const held = this.live()
        if (held === null || held.endpoint.protocol !== EDecisionsProtocol.OpenAi) return undefined
        return { url: held.endpoint.url, token: held.token, model: held.endpoint.model }
      },
    })
  }

  decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
    model?: string | undefined
  }): Promise<DecisionOutcome> {
    const held = this.live()
    if (held?.endpoint.protocol === EDecisionsProtocol.OpenAi) return this.openai.decide(args)
    return this.jev.decide({ ...args, model: args.model ?? held?.endpoint.model })
  }
}

export const createDecisionClient = (args: {
  settings: SettingsService
  secrets: SecretsPort
}): ProtocolDecisionClient => new ProtocolDecisionClient(liveDecisionsEndpoint(args))
