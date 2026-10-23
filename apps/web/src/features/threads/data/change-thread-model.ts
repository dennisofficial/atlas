import type { ThreadModelChoice } from './live-thread-view'

export async function changeThreadModel(args: {
  threadId: string
  model: ThreadModelChoice
  chooseLive: (model: ThreadModelChoice) => Promise<boolean>
  patch: (args: { threadId: string; model: ThreadModelChoice }) => Promise<void>
}): Promise<void> {
  await args.chooseLive(args.model)
  await args.patch({ threadId: args.threadId, model: args.model })
}
