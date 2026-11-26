import type { IModelMenuProps } from './model-menu-model'
import { ModelTrigger } from './model-trigger'

export const ModelMenu = ({ models, selection, pinnedRef, onOpenAll }: IModelMenuProps) => (
  <ModelTrigger models={models} selection={selection} pinnedRef={pinnedRef} onPress={onOpenAll} />
)
