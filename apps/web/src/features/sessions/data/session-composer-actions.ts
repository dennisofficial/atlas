import { EClientAction } from '@dltech/atlas-commands'

export const composerActionsOf = (args: {
  openModelPicker: () => void
  openCommandList: () => void
}): Record<EClientAction, () => void> => ({
  [EClientAction.ModelPicker]: args.openModelPicker,
  [EClientAction.CommandList]: args.openCommandList,
})
