import {
  EProviderFailureKind,
  EProviderFailureScope,
  ERunFailureKind,
  ModelPort,
  type Assembled,
  type ChunkFilter,
  type ModelStepResult,
  type ModelTraits,
  type ProviderIdentity,
  type ToolDeclaration,
} from '@dltech/atlas-core'
import { causeChainOf, TurnFault, type NormalizeFailure } from '@dltech/atlas-agent'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const missingCredentialIn = (chain: readonly unknown[]): boolean =>
  chain.some((link) => link instanceof TurnFault && link.kind === ERunFailureKind.MissingCredential)

const isCredentialFailure = (args: {
  fault: unknown
  normalizeFailure: NormalizeFailure
  nowMs: number
}): boolean => {
  if (missingCredentialIn(causeChainOf(args.fault))) return true
  const failure = args.normalizeFailure({
    cause: args.fault,
    message: messageOf(args.fault),
    nowMs: args.nowMs,
  })
  return (
    failure.scope === EProviderFailureScope.Credential &&
    (failure.kind === EProviderFailureKind.Auth || failure.kind === EProviderFailureKind.Quota)
  )
}

export type ChildFallbackArgs = {
  primary: ModelPort
  main: ModelPort
  normalizeFailure: NormalizeFailure
  onFallback: (fault: unknown) => void | Promise<void>
  nowMs?: (() => number) | undefined
}

export const childFallbackModel = (args: ChildFallbackArgs): ModelPort => {
  const nowMs = args.nowMs ?? Date.now

  return new (class extends ModelPort {
    private fellBack = false

    private get active(): ModelPort {
      return this.fellBack ? args.main : args.primary
    }

    get identity(): ProviderIdentity {
      return this.active.identity
    }

    override traits(): ModelTraits {
      return this.active.traits?.() ?? {}
    }

    async step(step: {
      assembled: Assembled
      tools: readonly ToolDeclaration[]
      signal: AbortSignal
      onChunk?: ChunkFilter
    }): Promise<ModelStepResult> {
      if (this.fellBack) return args.main.step(step)
      try {
        return await args.primary.step(step)
      } catch (fault) {
        if (step.signal.aborted) throw fault
        if (
          !isCredentialFailure({ fault, normalizeFailure: args.normalizeFailure, nowMs: nowMs() })
        ) {
          throw fault
        }
        this.fellBack = true
        await args.onFallback(fault)
        return args.main.step(step)
      }
    }
  })()
}
