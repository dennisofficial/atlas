import {
  clampToRungs,
  EFFORT_LADDER,
  roleKey,
  roleKeysOf,
  type EEffort,
  type ModelRole,
  type ResolvedModelChoice,
} from '@dltech/atlas-core'
import type { SettingScalar } from '@dltech/atlas-wire/web'

import { PAGE_ROLES } from './model-roles'
import { diffChanges, type ISettingChanges, type ISettingValues } from './setting-values'

export type IModelCatalogEntry = {
  id: string
  efforts?: readonly string[] | undefined
  fast?: boolean | undefined
  disabled?: boolean | undefined
}

export type IRoleDraft = { model: string; effort: string; fast: boolean }

export type IModelsDraft = Readonly<Record<string, IRoleDraft>>

export const FOLLOWER: IRoleDraft = { model: '', effort: '', fast: false }

export const effortRungsOf = (offered: readonly string[]): EEffort[] =>
  EFFORT_LADDER.filter((rung) => offered.includes(rung))

const draftOf = (args: { values: ISettingValues; role: ModelRole }): IRoleDraft => {
  const keys = roleKeysOf(args.role)
  const model = args.values.get(keys.model)
  const effort = args.values.get(keys.effort)
  const fast = args.values.get(keys.fast)
  return {
    model: typeof model === 'string' ? model : '',
    effort: typeof effort === 'string' ? effort : '',
    fast: fast === true,
  }
}

export function modelsDraftFrom(values: ISettingValues): IModelsDraft {
  const draft: Record<string, IRoleDraft> = {}
  for (const role of PAGE_ROLES) draft[roleKey(role)] = draftOf({ values, role })
  return draft
}

export function flattenModelsDraft(draft: IModelsDraft): Record<string, SettingScalar> {
  const flat: Record<string, SettingScalar> = {}
  for (const role of PAGE_ROLES) {
    const value = draft[roleKey(role)]
    if (value === undefined) continue
    const keys = roleKeysOf(role)
    flat[keys.model] = value.model
    flat[keys.effort] = value.effort
    flat[keys.fast] = value.fast
  }
  return flat
}

export function modelsChanges(args: { saved: IModelsDraft; draft: IModelsDraft }): ISettingChanges {
  return diffChanges({
    saved: flattenModelsDraft(args.saved),
    draft: flattenModelsDraft(args.draft),
  })
}

const rungOf = (stored: string): EEffort | undefined =>
  EFFORT_LADDER.find((effort) => effort === stored)

const startEffortOf = (args: {
  current: IRoleDraft
  inherited: ResolvedModelChoice
  follower: boolean
}): EEffort => (args.follower ? undefined : rungOf(args.current.effort)) ?? args.inherited.effort

export function pickedModelDraft(args: {
  draft: IModelsDraft
  role: ModelRole
  model: string
  option: IModelCatalogEntry | undefined
  inherited: ResolvedModelChoice
}): IModelsDraft {
  const current = args.draft[roleKey(args.role)] ?? FOLLOWER
  const follower = current.model === ''
  const effort = startEffortOf({ current, inherited: args.inherited, follower })
  const rungs = effortRungsOf(args.option?.efforts ?? [])
  const fast = (follower ? args.inherited.fast : current.fast) && args.option?.fast === true
  return {
    ...args.draft,
    [roleKey(args.role)]: {
      model: args.model,
      effort: clampToRungs({ rungs, effort }) ?? effort,
      fast,
    },
  }
}

export function followedDraft(args: { draft: IModelsDraft; role: ModelRole }): IModelsDraft {
  return { ...args.draft, [roleKey(args.role)]: FOLLOWER }
}

export function effortDraft(args: {
  draft: IModelsDraft
  role: ModelRole
  effort: string
}): IModelsDraft {
  const key = roleKey(args.role)
  const current = args.draft[key] ?? FOLLOWER
  return { ...args.draft, [key]: { ...current, effort: args.effort } }
}

export function fastDraft(args: {
  draft: IModelsDraft
  role: ModelRole
  fast: boolean
}): IModelsDraft {
  const key = roleKey(args.role)
  const current = args.draft[key] ?? FOLLOWER
  return { ...args.draft, [key]: { ...current, fast: args.fast } }
}
