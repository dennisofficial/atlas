import { setTimeout as pause } from 'node:timers/promises'

export type Agent37PollSignal = AbortSignal | undefined

export const pollPause = (args: { ms: number; signal?: Agent37PollSignal }): Promise<void> =>
  pause(args.ms, undefined, args.signal === undefined ? {} : { signal: args.signal })
