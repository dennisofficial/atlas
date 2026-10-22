import type { CloudChannel } from '@dltech/atlas-harness'
import type { RuntimeCheckpoint } from '@dltech/atlas-wire'

import { currentNotices, ENoticeTone } from '../../src/ui/notice-store'

export type WatchableChannel = Pick<
  CloudChannel,
  'connection' | 'onConnection' | 'checkpoint' | 'onCheckpoint'
>

export type ChannelWatch = {
  views: () => string[]
  checkpoints: () => RuntimeCheckpoint[]
  lastPhase: () => string | null
  stop: () => void
}

const WARNING_TONES: ReadonlySet<ENoticeTone> = new Set([ENoticeTone.Warn])

const BANNER_PATTERN = /parking|accepts no new work|disconnected|✗/i

const DEFAULT_POLL_MS = 1_000

export function watchChannel(args: {
  channel: WatchableChannel
  log: (line: string) => void
}): ChannelWatch {
  const views: string[] = [args.channel.connection().state]
  const checkpoints: RuntimeCheckpoint[] = []
  args.log(`view ${views[0]}`)

  const seeded = args.channel.checkpoint?.() ?? null
  if (seeded !== null) {
    checkpoints.push(seeded)
    args.log(`record ${seeded.phase} (revision ${seeded.revision})`)
  }

  const handleConnection = (connection: { state: string }): void => {
    if (views.at(-1) === connection.state) return
    views.push(connection.state)
    args.log(`view ${connection.state}`)
  }

  const handleCheckpoint = (checkpoint: RuntimeCheckpoint): void => {
    checkpoints.push(checkpoint)
    args.log(`record ${checkpoint.phase} (revision ${checkpoint.revision})`)
  }

  const unsubscribes = [
    args.channel.onConnection(handleConnection),
    args.channel.onCheckpoint?.(handleCheckpoint) ?? (() => undefined),
  ]

  return {
    views: () => [...views],
    checkpoints: () => [...checkpoints],
    lastPhase: () => checkpoints.at(-1)?.phase ?? null,
    stop: () => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
    },
  }
}

export function warnNotices(): { tone: string; text: string }[] {
  return currentNotices()
    .filter((notice) => WARNING_TONES.has(notice.tone))
    .map((notice) => ({ tone: notice.tone, text: notice.text }))
}

export function bannerIn(frame: string): string | null {
  const line = frame.split('\n').find((candidate) => BANNER_PATTERN.test(candidate))
  return line === undefined ? null : line.trim()
}

export async function waitFor(args: {
  what: string
  holds: () => Promise<boolean> | boolean
  within: number
  every?: number | undefined
}): Promise<boolean> {
  const deadline = Date.now() + args.within
  const every = args.every ?? DEFAULT_POLL_MS
  for (;;) {
    if (await args.holds()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await Bun.sleep(Math.min(every, remaining))
  }
}
