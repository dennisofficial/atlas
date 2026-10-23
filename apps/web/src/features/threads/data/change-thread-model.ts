import type { ThreadModelChoice } from './live-thread-view'

export async function changeThreadModel(args: {
  threadId: string
  model: ThreadModelChoice
  chooseLive: (model: ThreadModelChoice) => Promise<boolean>
  patch: (args: { threadId: string; model: ThreadModelChoice }) => Promise<void>
}): Promise<void> {
  if (await args.chooseLive(args.model)) return
  await args.patch({ threadId: args.threadId, model: args.model })
}
