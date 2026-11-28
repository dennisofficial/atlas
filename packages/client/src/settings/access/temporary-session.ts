export const revealWithTemporarySession = async (args: {
  token: string
  isPending: () => boolean
  reveal: (token: string) => Promise<void>
  revoke: (token: string) => Promise<void>
}): Promise<void> => {
  try {
    if (!args.isPending()) return
    await args.reveal(args.token)
  } finally {
    await args.revoke(args.token)
  }
}
