import { effortRungOf } from '../../settings/effort-rows'
import { DEFAULT_EFFORT } from '../../settings/registry'
import { clampToRungs, type EEffort } from '../effort-ladder'
import { parseRef, type ModelRef } from '../ref'
import type { CapabilitiesOf, ModelCapabilities } from './capabilities'
import { EModelRole, parentOf, roleKey, roleKeysOf, type ModelRole } from './roles'

export type ModelChoice = { ref: ModelRef; effort: EEffort; fast: boolean }

export enum EStalePolicy {
  Keep = 'keep',
  Follow = 'follow',
}

export type ResolvedModelChoice = ModelChoice & {
  role: ModelRole
  source: ModelRole
  follows: ModelRole | undefined
  stale: boolean
}

export type ResolveModelChoiceArgs = {
  role: ModelRole
  read: (settingId: string) => string | boolean | undefined
  capabilitiesOf: CapabilitiesOf
  fallback: ModelRef
  root?: ModelChoice
  pinned?: (agentType: string) => string | undefined
  stale?: EStalePolicy
}

const refOfValue = (value: string | boolean | undefined): ModelRef | undefined =>
  typeof value === 'string' ? parseRef(value) : undefined

const pinnedRefOf = (args: ResolveModelChoiceArgs, role: ModelRole): ModelRef | undefined =>
  typeof role === 'string' ? undefined : parseRef(args.pinned?.(role.agentType) ?? '')

const ownRefOf = (args: ResolveModelChoiceArgs, role: ModelRole): ModelRef | undefined =>
  refOfValue(args.read(roleKeysOf(role).model)) ?? pinnedRefOf(args, role)

const staleOf = (capabilities: ModelCapabilities | undefined): boolean =>
  capabilities === undefined || !capabilities.runnable

const clampedEffortOf = (args: {
  capabilities: ModelCapabilities | undefined
  effort: EEffort
}): EEffort =>
  args.capabilities === undefined
    ? args.effort
    : (clampToRungs({ rungs: args.capabilities.efforts, effort: args.effort }) ?? args.effort)

const offeredFastOf = (args: {
  capabilities: ModelCapabilities | undefined
  fast: boolean
}): boolean => args.fast && args.capabilities?.fast === true

const effortReadOf = (args: ResolveModelChoiceArgs, role: ModelRole): EEffort | undefined => {
  const value = args.read(roleKeysOf(role).effort)
  return typeof value === 'string' ? effortRungOf(value) : undefined
}

const fastReadOf = (args: ResolveModelChoiceArgs, role: ModelRole): boolean =>
  args.read(roleKeysOf(role).fast) === true

const choiceOn = (args: {
  capabilities: ModelCapabilities | undefined
  role: ModelRole
  ref: ModelRef
  effort: EEffort
  fast: boolean
  source: ModelRole
  stale: boolean
}): ResolvedModelChoice => ({
  role: args.role,
  ref: args.ref,
  effort: clampedEffortOf({ capabilities: args.capabilities, effort: args.effort }),
  fast: offeredFastOf({ capabilities: args.capabilities, fast: args.fast }),
  source: args.source,
  follows: undefined,
  stale: args.stale,
})

const followedChoice = (args: {
  capabilitiesOf: CapabilitiesOf
  role: ModelRole
  parent: ResolvedModelChoice
  stale: boolean
}): ResolvedModelChoice => {
  const capabilities = args.capabilitiesOf(args.parent.ref)
  return {
    role: args.role,
    ref: args.parent.ref,
    effort: clampedEffortOf({ capabilities, effort: args.parent.effort }),
    fast: offeredFastOf({ capabilities, fast: args.parent.fast }),
    source: args.parent.source,
    follows: parentOf(args.role),
    stale: args.stale,
  }
}

export function resolveModelChoice(args: ResolveModelChoiceArgs): ResolvedModelChoice {
  const policy = args.stale ?? EStalePolicy.Keep

  const mainChoice = (): ResolvedModelChoice => {
    const on = (ref: ModelRef, stale: boolean): ResolvedModelChoice =>
      choiceOn({
        capabilities: args.capabilitiesOf(ref),
        role: EModelRole.Main,
        ref,
        effort: effortReadOf(args, EModelRole.Main) ?? DEFAULT_EFFORT,
        fast: fastReadOf(args, EModelRole.Main),
        source: EModelRole.Main,
        stale,
      })

    if (args.root !== undefined) {
      return choiceOn({
        capabilities: args.capabilitiesOf(args.root.ref),
        role: EModelRole.Main,
        ref: args.root.ref,
        effort: args.root.effort,
        fast: args.root.fast,
        source: EModelRole.Main,
        stale: false,
      })
    }

    const own = refOfValue(args.read(roleKeysOf(EModelRole.Main).model))
    if (own === undefined) return on(args.fallback, false)
    if (policy === EStalePolicy.Follow && staleOf(args.capabilitiesOf(own))) {
      return on(args.fallback, true)
    }
    return on(own, staleOf(args.capabilitiesOf(own)))
  }

  const resolve = (role: ModelRole): ResolvedModelChoice => {
    if (role === EModelRole.Main) return mainChoice()

    const parent = parentOf(role)
    const inherited = parent === undefined ? mainChoice() : resolve(parent)
    const own = ownRefOf(args, role)

    if (own === undefined) {
      return followedChoice({
        capabilitiesOf: args.capabilitiesOf,
        role,
        parent: inherited,
        stale: false,
      })
    }
    if (policy === EStalePolicy.Follow && staleOf(args.capabilitiesOf(own))) {
      return followedChoice({
        capabilitiesOf: args.capabilitiesOf,
        role,
        parent: inherited,
        stale: true,
      })
    }

    return choiceOn({
      capabilities: args.capabilitiesOf(own),
      role,
      ref: own,
      effort: effortReadOf(args, role) ?? inherited.effort,
      fast: fastReadOf(args, role),
      source: role,
      stale: staleOf(args.capabilitiesOf(own)),
    })
  }

  return resolve(args.role)
}

export function resolveModelChoices(
  args: Omit<ResolveModelChoiceArgs, 'role'> & { roles: readonly ModelRole[] },
): ReadonlyMap<string, ResolvedModelChoice> {
  const { roles, ...choiceArgs } = args
  const resolved = new Map<string, ResolvedModelChoice>()
  for (const role of roles) resolved.set(roleKey(role), resolveModelChoice({ ...choiceArgs, role }))
  return resolved
}
