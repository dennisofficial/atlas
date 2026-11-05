export const liveKeyOf = (args: { threadId: string; tabId: string }): string =>
  `${args.threadId}:${args.tabId}`
