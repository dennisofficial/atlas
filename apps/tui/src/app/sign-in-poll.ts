export type SignInPollStatus = 'pending' | 'complete' | 'expired'

export const pollSignInUntilSettled = async (args: {
  intervalMs: number
  expiresInMs: number
  poll: () => Promise<{ status: string }>
  wait: (ms: number) => Promise<void>
  now: () => number
  isCancelled: () => boolean
}): Promise<{ status: string } | null> => {
  const deadline = args.now() + args.expiresInMs

  while (true) {
    await args.wait(args.intervalMs)
    if (args.isCancelled()) return null
    if (args.now() > deadline) return { status: 'expired' }

    const answer = await args.poll()
    if (answer.status !== 'pending') return answer
  }
}
