import { ESpan, spanWith, type SpanHandle, type TracePort } from '@dltech/atlas-observability'
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

export const MODEL_READ_TIMEOUT_MS = 500

const TIMED_OUT = Symbol('timed-out')

const withinTimeout = <T>(args: {
  work: Promise<T>
  ms: number
}): Promise<T | typeof TIMED_OUT> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), args.ms)
  })
  return Promise.race([args.work, timeout]).finally(() => clearTimeout(timer))
}

export class LiveModelPort extends ModelPort {
  private inner: AiSdkModelPort
  private key: string

  constructor(
    private readonly args: {
      initial: ResolvedRoleModel
      read: () => Promise<ResolvedRoleModel>
      build: (resolved: ResolvedRoleModel) => AiSdkModelPort
      onReadFailure?: (error: unknown) => void
      onReadTimeout?: (args: { timeoutMs: number }) => void
      readTimeoutMs?: number | undefined
      trace?: TracePort | undefined
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

  private refresh(): Promise<void> {
    return spanWith(this.args.trace, {
      name: ESpan.ModelResolve,
      fields: { provider: this.inner.identity.id, model: this.inner.identity.modelId },
      run: (span) => this.applyRefresh(span),
    })
  }

  private async applyRefresh(span: SpanHandle): Promise<void> {
    const timeoutMs = this.args.readTimeoutMs ?? MODEL_READ_TIMEOUT_MS
    let next: ResolvedRoleModel | typeof TIMED_OUT
    try {
      next = await withinTimeout({ work: this.args.read(), ms: timeoutMs })
    } catch (error) {
      span.set({ phase: 'read-failed' })
      this.args.onReadFailure?.(error)
      return
    }
    if (next === TIMED_OUT) {
      span.set({ phase: 'timed-out' })
      this.args.onReadTimeout?.({ timeoutMs })
      return
    }
    const key = keyOf(next)
    if (key === this.key) {
      span.set({ phase: 'kept' })
      return
    }
    this.inner = this.args.build(next)
    this.key = key
    span.set({
      phase: 'rebuilt',
      provider:
        next.config.configured === true ? next.config.ref.providerId : next.choice.ref.providerId,
      model: next.choice.ref.modelId,
    })
  }
}
