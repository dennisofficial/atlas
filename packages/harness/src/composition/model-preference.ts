import {
  choiceValueOf,
  clampEffort,
  DEFAULT_EFFORT,
  EFFORT_LADDER,
  ESettingId,
  parseRef,
  refKey,
  textValueOf,
  toggleValueOf,
  type EEffort,
  type ModelRef,
  type SettingsResolution,
} from '@dltech/atlas-core'
import type { SettingsService, SettingsWrite } from '../settings/service'
import type { ThreadModel } from '../store/thread-store'

import { DEFAULT_MODEL_REF, type LaunchModel } from './config'
import { isRefReachable, type ModelCatalogue } from './model-catalogue'
import type { ModelSelection } from './model-selection'

const usableRef = (args: {
  reference: string | undefined
  catalogue: ModelCatalogue
}): ModelRef | undefined => {
  if (args.reference === undefined || args.reference.length === 0) return undefined

  const ref = parseRef(args.reference)
  if (ref === undefined) return undefined

  return isRefReachable({ catalogue: args.catalogue, ref }) ? ref : undefined
}

const usableEffort = (held: string | undefined): EEffort | undefined =>
  EFFORT_LADDER.find((effort) => effort === held)

const settled = (args: {
  ref: ModelRef
  effort: EEffort
  fast: boolean
  catalogue: ModelCatalogue
}): ModelSelection => {
  const card = args.catalogue.cardFor(args.ref)
  return {
    ref: args.ref,
    effort: clampEffort({ map: card?.effort, effort: args.effort }) ?? args.effort,
    fast: args.fast && card?.fast === true,
  }
}

/**
 * Nobody's choice can hardcode a provider: a user with only OpenRouter set up cannot run the
 * shipped Anthropic default. The shipped ref leads when it is reachable; otherwise the first
 * reachable provider's first card answers, and only a launch with no accounts at all — which
 * onboarding intercepts before this matters — falls back to the shipped ref unanswered.
 */
export function fallbackRef(args: { catalogue: ModelCatalogue }): ModelRef {
  if (isRefReachable({ catalogue: args.catalogue, ref: DEFAULT_MODEL_REF }))
    return DEFAULT_MODEL_REF

  const offered = args.catalogue.providers.find((provider) => args.catalogue.reachable(provider.id))
    ?.cards[0]
  return offered?.ref ?? DEFAULT_MODEL_REF
}

/** The pair a conversation with no model of its own starts on, as the layers settled it. */
export function defaultSelection(args: {
  settled: SettingsResolution
  catalogue: ModelCatalogue
}): ModelSelection {
  const reference = textValueOf({ resolution: args.settled, id: ESettingId.ModelId })
  const effort = choiceValueOf({
    resolution: args.settled,
    id: ESettingId.ModelEffort,
    fallback: DEFAULT_EFFORT,
  })

  return settled({
    ref: usableRef({ reference, catalogue: args.catalogue }) ?? fallbackRef(args),
    effort: usableEffort(effort) ?? DEFAULT_EFFORT,
    fast: toggleValueOf({ resolution: args.settled, id: ESettingId.ModelFast }),
    catalogue: args.catalogue,
  })
}

/**
 * A model named on the command line is an override for that launch, so it outranks both the default
 * the settings hold and whatever the thread it lands on was last switched to.
 */
export function launchSelection(args: {
  requested: { model: LaunchModel | undefined }
  settled: SettingsResolution
  catalogue: ModelCatalogue
}): ModelSelection {
  const asked = usableRef({ reference: args.requested.model?.ref, catalogue: args.catalogue })
  const fallback = defaultSelection({ settled: args.settled, catalogue: args.catalogue })
  if (asked === undefined) return fallback

  const effort = usableEffort(args.requested.model?.effort) ?? fallback.effort
  const fast = args.requested.model?.fast ?? fallback.fast === true
  return settled({ ref: asked, effort, fast, catalogue: args.catalogue })
}

/** Whether a launch is pinned to one model, in which case the thread it opens does not get a say. */
export const modelPinned = (args: {
  requested: { model: LaunchModel | undefined }
  catalogue: ModelCatalogue
}): boolean =>
  usableRef({ reference: args.requested.model?.ref, catalogue: args.catalogue }) !== undefined

/**
 * A thread that names a model nobody can answer for — one that left the catalogue, or whose account
 * is gone — falls back whole rather than in halves, so the effort never outlives its model.
 */
export function threadSelection(args: {
  stored: ThreadModel | undefined
  fallback: ModelSelection
  catalogue: ModelCatalogue
}): ModelSelection {
  const ref = usableRef({ reference: args.stored?.ref, catalogue: args.catalogue })
  if (ref === undefined) return args.fallback

  return settled({
    ref,
    effort: usableEffort(args.stored?.effort) ?? args.fallback.effort,
    fast: args.stored?.fast ?? false,
    catalogue: args.catalogue,
  })
}

export const storedModel = (selection: ModelSelection): ThreadModel => ({
  ref: refKey(selection.ref),
  effort: selection.effort,
  ...(selection.fast === true ? { fast: true } : {}),
})

export function settingModelRef(args: {
  id: string
  settled: SettingsResolution
  catalogue: ModelCatalogue
}): ModelRef | undefined {
  return usableRef({
    reference: textValueOf({ resolution: args.settled, id: args.id }),
    catalogue: args.catalogue,
  })
}

export function rememberSettingModel(args: {
  settings: SettingsService
  target: { id: string; withEffort: boolean }
  selection: ModelSelection
}): SettingsWrite {
  const written = args.settings.set({ id: args.target.id, value: refKey(args.selection.ref) })
  if (!written.ok || !args.target.withEffort) return written
  return args.settings.set({ id: ESettingId.ModelEffort, value: args.selection.effort })
}
