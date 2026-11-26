import {
  type IModelOption,
  type IModelSelection,
  modelGroupsOf,
  pinnedModelsOf,
  withoutPinned,
} from './model-options'

export const PINNED_MENU_TITLE = 'Pinned'

export interface IModelMenuSection {
  title: string
  models: readonly IModelOption[]
}

export const modelMenuSectionsOf = ({
  models,
  pinned,
}: {
  models: readonly IModelOption[]
  pinned: readonly string[]
}): readonly IModelMenuSection[] => {
  const pinnedModels = pinnedModelsOf({ models, pinned })
  const pinnedSection: IModelMenuSection[] =
    pinnedModels.length === 0 ? [] : [{ title: PINNED_MENU_TITLE, models: pinnedModels }]
  const providerSections = modelGroupsOf(withoutPinned({ models, pinned })).map((group) => ({
    title: group.provider,
    models: group.models,
  }))
  return [...pinnedSection, ...providerSections]
}

export const modelMenuSelectionImageOf = ({
  model,
  selectedId,
}: {
  model: IModelOption
  selectedId: string | null
}): 'checkmark' | undefined => (model.id === selectedId ? 'checkmark' : undefined)

export interface IModelMenuProps {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinned: readonly string[]
  pinnedRef?: string | null
  defaultRow?: boolean | undefined
  onSelect: (selection: IModelSelection | null) => void
  onOpenAll: () => void
}
