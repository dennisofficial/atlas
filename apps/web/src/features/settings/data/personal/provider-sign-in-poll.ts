import { EProviderSignInPoll, type ProviderSignInPoll } from '@dltech/atlas-wire/web'

export async function pollSignInUntilSettled(args: {
  attemptId: string
  intervalMs: number
  expiresInMs: number
  poll: (attemptId: string) => Promise<ProviderSignInPoll>
  wait: (ms: number) => Promise<void>
  now: () => number
  isCancelled: () => boolean
}): Promise<ProviderSignInPoll | null> {
  const deadline = args.now() + args.expiresInMs
  for (;;) {
    await args.wait(args.intervalMs)
    if (args.isCancelled()) return null
    if (args.now() > deadline) return { status: EProviderSignInPoll.Expired }
    const result = await args.poll(args.attemptId)
    if (args.isCancelled()) return null
    if (result.status !== EProviderSignInPoll.Pending) return result
  }
}
