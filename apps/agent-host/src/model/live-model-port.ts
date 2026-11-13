import {
  ModelPort,
  type ModelStepResult,
  type ModelTraits,
  type ProviderIdentity,
} from '@dltech/atlas-core'

import type { ModelConfig } from '../config/agent-host-config'
import type { AiSdkModelPort } from './ai-sdk-model-port'

const keyOf = (config: ModelConfig): string =>
  config.configured === false
    ? `gap:${config.gap}`
    : [
        `${config.ref.providerId}/${config.ref.modelId}`,
        config.effort,
        config.fast ? 'fast' : 'steady',
        config.accountId,
        config.credential.kind === 'api-key'
          ? `api-key:${config.credential.apiKey}`
          : `oauth:${config.credential.connectionId}`,
      ].join('|')

export class LiveModelPort extends ModelPort {
  private inner: AiSdkModelPort
  private key: string

  constructor(
    private readonly args: {
      initial: ModelConfig
      read: () => Promise<ModelConfig>
      build: (config: ModelConfig) => AiSdkModelPort
      onReadFailure?: (error: unknown) => void
    },
  ) {
    super()
    this.inner = args.build(args.initial)
    this.key = keyOf(args.initial)
  }

  get identity(): ProviderIdentity {
    return this.inner.identity
  }

  override traits(): ModelTraits {
    return this.inner.traits()
  }

  async step(args: Parameters<ModelPort['step']>[0]): Promise<ModelStepResult> {
    await this.refresh()
    return this.inner.step(args)
  }

  private async refresh(): Promise<void> {
    let next: ModelConfig
    try {
      next = await this.args.read()
    } catch (error) {
      this.args.onReadFailure?.(error)
      return
    }
    const key = keyOf(next)
    if (key === this.key) return
    this.inner = this.args.build(next)
    this.key = key
  }
}
