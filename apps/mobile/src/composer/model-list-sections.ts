import {
  type IModelOption,
  modelGroupsOf,
  pinnedModelsOf,
  searchModelsOf,
  withoutPinned,
} from './model-options'

export const PINNED_SECTION_TITLE = 'Pinned'
const PINNED_SECTION_KEY = 'pinned'

export type TModelListItem = { key: string; model: IModelOption }

export type TModelListSection = {
  key: string
  title: string
  data: readonly TModelListItem[]
}

const modelItemsOf = ({
  section,
  models,
}: {
  section: string
  models: readonly IModelOption[]
}): TModelListItem[] => models.map((model) => ({ key: `${section}:${model.id}`, model }))

export const modelListSectionsOf = ({
  models,
  pinned,
  query,
}: {
  models: readonly IModelOption[]
  pinned: readonly string[]
  query: string
}): readonly TModelListSection[] => {
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
  return [...pinnedSection, ...providerSections]
}

export const hasModelMatchesOf = (sections: readonly TModelListSection[]): boolean =>
  sections.some((section) => section.data.length > 0)
