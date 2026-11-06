export const mediaPathname = (args: { userId: string; hash: string }): string =>
  `media/${args.userId}/${args.hash}`
