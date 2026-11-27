import {
  type IModelOption,
  modelGroupsOf,
  pinnedModelsOf,
  searchModelsOf,
  withoutPinned,
} from './model-options'

export const PINNED_SECTION_TITLE = 'Pinned'
const DEFAULT_SECTION_KEY = 'default'
const PINNED_SECTION_KEY = 'pinned'

export enum EModelListItem {
  Default = 'default',
  Model = 'model',
}

export type TModelListItem =
  | { kind: EModelListItem.Default; key: string }
  | { kind: EModelListItem.Model; key: string; model: IModelOption }

export type TModelListSection = {
  key: string
  title: string | null
  data: readonly TModelListItem[]
}

const modelItemsOf = ({
  section,
  models,
}: {
  section: string
  models: readonly IModelOption[]
}): TModelListItem[] =>
  models.map((model) => ({ kind: EModelListItem.Model, key: `${section}:${model.id}`, model }))

export const modelListSectionsOf = ({
  models,
  pinned,
  query,
  defaultRow,
}: {
  models: readonly IModelOption[]
  pinned: readonly string[]
  query: string
  defaultRow: boolean
}): readonly TModelListSection[] => {
  const defaultSection: TModelListSection[] =
    defaultRow && query.trim() === ''
      ? [
          {
            key: DEFAULT_SECTION_KEY,
            title: null,
            data: [{ kind: EModelListItem.Default, key: DEFAULT_SECTION_KEY }],
          },
        ]
      : []
  const pinnedShown = searchModelsOf({ models: pinnedModelsOf({ models, pinned }), query })
  const pinnedSection: TModelListSection[] =
    pinnedShown.length === 0
      ? []
      : [
          {
            key: PINNED_SECTION_KEY,
            title: PINNED_SECTION_TITLE,
            data: modelItemsOf({ section: PINNED_SECTION_KEY, models: pinnedShown }),
          },
        ]
  const providerSections = modelGroupsOf(
    searchModelsOf({ models: withoutPinned({ models, pinned }), query }),
  ).map((group) => ({
    key: group.providerId,
    title: group.provider,
    data: modelItemsOf({ section: group.providerId, models: group.models }),
  }))
  return [...defaultSection, ...pinnedSection, ...providerSections]
}

export const hasModelMatchesOf = (sections: readonly TModelListSection[]): boolean =>
  sections.some((section) => section.data.some((item) => item.kind === EModelListItem.Model))
