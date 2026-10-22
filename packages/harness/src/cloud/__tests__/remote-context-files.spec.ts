import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { ChannelListener } from '../../channel/delta-channel'
import { EClientRequest } from '../channel-wire'
import { RemoteContextFiles } from '../remote-context-files'

describe('RemoteContextFiles', () => {
  it('asks for the listing and parses the reply', async () => {
    const calls: Array<{ op: EClientRequest; params: unknown }> = []
    const files = new RemoteContextFiles({
      channel: {
        request: async (args) => {
          calls.push(args)
          return { entries: [{ name: 'plan.md', isDirectory: false }] }
        },
      },
    })

    expect(await files.list()).toEqual([{ name: 'plan.md', isDirectory: false }])
    expect(await files.list('specs')).toEqual([{ name: 'plan.md', isDirectory: false }])
    expect(calls).toEqual([
      { op: EClientRequest.ListContextFiles, params: {} },
      { op: EClientRequest.ListContextFiles, params: { directory: 'specs' } },
    ])
  })

  it('asks for one file and parses the content union', async () => {
    const files = new RemoteContextFiles({
      channel: {
        request: async () => ({ file: { type: 'text', content: '# plan\n', truncated: false } }),
      },
    })

    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# plan\n', truncated: false })
  })

  it('parses a refused file the same union', async () => {
    const files = new RemoteContextFiles({
      channel: {
        request: async () => ({ file: { type: 'refused', reason: 'the file is binary' } }),
      },
    })

    expect(await files.load('bin.dat')).toEqual({ type: 'refused', reason: 'the file is binary' })
  })

  it('refreshes on pushed context changes and releases its subscription', () => {
    const held: { listener: ChannelListener | undefined } = { listener: undefined }
    let changes = 0
    let stopped = false
    const files = new RemoteContextFiles({ channel: {
      threadId: toThreadId('session'),
      request: async () => ({ entries: [] }),
      subscribe: ({ listener }) => {
        held.listener = listener
        return () => { held.listener = undefined; stopped = true }
      },
    } })
    const stop = files.subscribe(() => { changes += 1 })
    held.listener?.({ type: 'turn-working', working: true })
    expect(changes).toBe(0)
    held.listener?.({ type: 'context-changed' })
    expect(changes).toBe(1)
    stop()
    expect(stopped).toBe(true)
  })

  it('surfaces a garbage reply as a parse failure, not data', async () => {
    const files = new RemoteContextFiles({
      channel: {
        request: async () => ({ entries: 'not-an-array' }),
      },
    })

    await expect(files.list()).rejects.toThrow()
  })
})
