import {
  EGithubPollStatus,
  type GithubDeviceCodes,
  type GithubPollResult,
} from '@dltech/atlas-wire/web'

const SLOW_DOWN_STEP_MS = 5000

export async function pollUntilSettled(args: {
  codes: GithubDeviceCodes
  poll: (deviceCode: string) => Promise<GithubPollResult>
  wait: (ms: number) => Promise<void>
  now: () => number
  isCancelled: () => boolean
}): Promise<GithubPollResult | null> {
  const deadline = args.now() + args.codes.expiresInMs
  let intervalMs = args.codes.intervalMs
  for (;;) {
    await args.wait(intervalMs)
    if (args.isCancelled()) return null
    if (args.now() > deadline) return { status: EGithubPollStatus.Expired }
    const result = await args.poll(args.codes.deviceCode)
    if (args.isCancelled()) return null
    if (result.status === EGithubPollStatus.SlowDown) intervalMs += SLOW_DOWN_STEP_MS
    else if (result.status !== EGithubPollStatus.Pending) return result
  }
}
