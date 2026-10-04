import {
  isAuthFailure,
  ModelPort,
  type Assembled,
  type ChunkFilter,
  type ModelStepResult,
  type ModelTraits,
  type ProviderIdentity,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { modelFailureOf } from '../model/failure'

/**
 * The retry loop's handle for giving up on a child model: an explicit switch to the parent's model,
 * called when a retryable fault has spent its budget. Distinct from the auth short-circuit inside
 * `step` — that one fires on first contact with a dead credential, this one fires only once the
 * loop has genuinely run out of retries on a fault that was worth retrying.
 */
export type ChildFallbackSwitch = {
  /** Switch to the parent model for the rest of the run. False when there is no parent to fall to. */
  switch: () => boolean
}

export type ChildFallbackModel = ModelPort & ChildFallbackSwitch

/**
 * A child's model, wrapped so a dead credential does not kill the child. The only fault that
 * short-circuits inside `step` is an auth one (401/402/403): retrying a bad key is pointless, so
 * the step is handed straight to the parent's current session model. Every other fault is rethrown
 * so the retry loop above still owns backoff, and only the loop's `switch()` — fired when the
 * budget is spent — moves a retryable failure to the parent. Once switched, either way, the port
 * never returns to the model that already failed.
 *
 * The parent is resolved lazily on each step, so a model the operator switches to mid-session is
 * the one the child follows. `parentFor` returns undefined when the child already runs the parent
 * model, in which case neither an auth fault nor an exhausted retry has anywhere to fall to.
 */
export function childFallbackModel(args: {
  primary: ModelPort
  parentFor: () => ModelPort | undefined
  onFallback: (fault: unknown) => void
}): ChildFallbackModel {
  let fellBack = false

  const active = (): ModelPort => {
    if (!fellBack) return args.primary
    return args.parentFor() ?? args.primary
  }

  const fallBack = (fault: unknown): ModelPort | undefined => {
    const parent = args.parentFor()
    if (parent === undefined) return undefined
    fellBack = true
    args.onFallback(fault)
    return parent
  }

  return new (class extends ModelPort {
    get identity(): ProviderIdentity {
      return active().identity
    }

    override traits(): ModelTraits {
      return active().traits?.() ?? {}
    }

    switch(): boolean {
      if (fellBack) return false
      return fallBack(undefined) !== undefined
    }

    async step(stepArgs: {
      assembled: Assembled
      tools: readonly ToolDeclaration[]
      signal: AbortSignal
      onChunk?: ChunkFilter
    }): Promise<ModelStepResult> {
      if (fellBack) return active().step(stepArgs)

      try {
        return await args.primary.step(stepArgs)
      } catch (fault) {
        const failure = modelFailureOf(fault)
        if (failure === null || !isAuthFailure(failure)) throw fault

        const parent = fallBack(fault)
        if (parent === undefined) throw fault

        return parent.step(stepArgs)
      }
    }
  })()
}
