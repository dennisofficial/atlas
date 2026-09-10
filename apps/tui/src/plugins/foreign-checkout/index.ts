import {
  EBeforeToolDecision,
  EHookPhase,
  EStage,
  EToolEffect,
  foreignCheckoutDenial,
  type BeforeTool,
  type HookOrder,
} from '@dltech/atlas-core'
import { portToken, type DependencyContainer } from '@dltech/atlas-harness'

import { NativePlugin, type PluginContribution } from '../plugin'

const GUARD: HookOrder = { stage: EStage.Guard, nudge: -1 }

const declaredPath = (input: unknown): string | undefined => {
  if (typeof input !== 'object' || input === null || !('path' in input)) return undefined
  const path = input.path
  return typeof path === 'string' ? path : undefined
}

export const guardForeignCheckout: BeforeTool = async ({ call, projectDirectory }) => {
  if (call.effect !== EToolEffect.Write) {
    return { decision: EBeforeToolDecision.Allow, input: call.input }
  }

  const path = declaredPath(call.input)
  const reason =
    path === undefined ? undefined : foreignCheckoutDenial({ path, projectDirectory })

  if (reason === undefined) {
    return { decision: EBeforeToolDecision.Allow, input: call.input }
  }

  return { decision: EBeforeToolDecision.Deny, reason }
}

export default class ForeignCheckoutPlugin extends NativePlugin {
  readonly id = 'foreign-checkout'

  contribute(): PluginContribution {
    return {
      hooks: [
        {
          phase: EHookPhase.BeforeTool,
          name: 'guard-writes',
          order: GUARD,
          run: guardForeignCheckout,
        },
      ],
    }
  }
}

export function registerPlugin({ container }: { container: DependencyContainer }): void {
  container.register(portToken(NativePlugin), { useClass: ForeignCheckoutPlugin })
}
