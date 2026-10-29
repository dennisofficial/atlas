import { describe, expect, it } from 'bun:test'

import {
  watchContextFiles,
  type ContextFilesChannel,
  type ContextLevel,
} from '../context-files-source'

function fake() {
  const calls: unknown[] = []
  let signal: (type: string) => void = () => undefined
  let unsubscribed = false
  const channel = {
    threadId: 't',
    request: async (args: { params: unknown }) => {
      calls.push(args.params)
      return { entries: [{ name: 'a.md', isDirectory: false }] }
    },
    subscribe: (args: { listener: (s: { type: string }) => void }) => {
      signal = (type) => args.listener({ type })
      return () => void (unsubscribed = true)
    },
    onReload: () => () => undefined,
    onReady: () => () => undefined,
  } as unknown as ContextFilesChannel
  return {
    channel,
    calls,
    signal: (t: string) => signal(t),
    unsubscribed: () => unsubscribed,
  }
}

describe('watchContextFiles', () => {
  it('lists the root, refreshes loaded levels on context-changed, and cleans up', async () => {
    const f = fake()
    const levels: { directory: string; level: ContextLevel }[] = []
    const watch = watchContextFiles({
      channel: f.channel,
      onLevel: (u) => levels.push(u),
    })
    await Bun.sleep(0)
    watch.load('docs')
    await Bun.sleep(0)
    f.signal('context-changed')
    await Bun.sleep(0)
    expect(f.calls).toEqual([{}, { directory: 'docs' }, {}, { directory: 'docs' }])
    expect(levels[0]?.level.entries).toHaveLength(1)
    watch.stop()
    expect(f.unsubscribed()).toBe(true)
  })
})
