import { EClientAction } from '@dltech/atlas-commands'

export const composerActionsOf = (args: {
  openModelPicker: () => void
  openCommandList: () => void
  reportHidden: (name: string) => void
}): Record<EClientAction, () => void> => ({
  [EClientAction.ModelPicker]: args.openModelPicker,
  [EClientAction.CommandList]: args.openCommandList,
  [EClientAction.Skills]: () => args.reportHidden('skills'),
  [EClientAction.Mcp]: () => args.reportHidden('mcp'),
  [EClientAction.Shells]: () => args.reportHidden('shells'),
})
