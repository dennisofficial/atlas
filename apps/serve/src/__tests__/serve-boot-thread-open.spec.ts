import { afterEach, describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import { fakeServeApp } from './fakes'
import { releaseServeSpec, startWithHomeSpec, threadId } from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe thread open', () => {
  it('opens the served thread in its directory and tells the channel its log grew', async () => {
    const opened: { threadId: ThreadId; projectDirectory: string }[] = []
    const published: ThreadId[] = []
    await startWithHomeSpec({
      compose: async () => {
        const app = fakeServeApp({ threadId, root: '/workspace' })
        const publisherFor = app.channel.publisherFor.bind(app.channel)
        app.channel.publisherFor = (args) => {
          published.push(args.threadId)
          return publisherFor(args)
        }
        app.threadOpened = async (args) => {
          opened.push(args)
        }
        return app
      },
    })

    expect(opened.map((one) => one.threadId)).toEqual([threadId])
    expect(opened[0]?.projectDirectory.endsWith('/workspace')).toBe(true)
    expect(published).toContain(threadId)
  })

  it('still boots when opening the thread fails', async () => {
    const handle = await startWithHomeSpec({
      compose: async () => {
        const app = fakeServeApp({ threadId, root: '/workspace' })
        app.threadOpened = async () => {
          throw new Error('probe exploded')
        }
        return app
      },
    })

    expect(handle).toBeDefined()
  })
})
