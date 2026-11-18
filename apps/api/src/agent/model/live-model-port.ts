import {
  ModelPort,
  type ModelStepResult,
  type ModelTraits,
  type ProviderIdentity,
  type ResolvedModelChoice,
} from '@dltech/atlas-core'

import type { ModelConfig } from '../config/agent-host-config'
import type { ResolvedRoleModel } from '../config/model-config'
import type { AiSdkModelPort } from './ai-sdk-model-port'

const configKeyOf = (config: ModelConfig): string =>
  config.configured === false
    ? `gap:${config.gap}`
    : [
        config.accountId,
        config.credential.kind === 'api-key'
          ? `api-key:${config.credential.apiKey}`
          : `oauth:${config.credential.connectionId}`,
      ].join('|')

const choiceKeyOf = (choice: ResolvedModelChoice): string =>
  [
    `${choice.ref.providerId}/${choice.ref.modelId}`,
    choice.effort,
    choice.fast ? 'fast' : 'steady',
  ].join('|')

const keyOf = (resolved: ResolvedRoleModel): string =>
  `${choiceKeyOf(resolved.choice)}|${configKeyOf(resolved.config)}`

export class LiveModelPort extends ModelPort {
  private inner: AiSdkModelPort
  private key: string

  constructor(
    private readonly args: {
      initial: ResolvedRoleModel
      read: () => Promise<ResolvedRoleModel>
      build: (resolved: ResolvedRoleModel) => AiSdkModelPort
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
    let next: ResolvedRoleModel
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
