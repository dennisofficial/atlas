import { afterEach, describe, expect, it } from 'bun:test'
import { testRedisUrl } from './testing/real-redis.fixture'
import { githubRedisOf, type GithubRedisConnection } from './github-redis'

describe('githubRedisOf', () => {
  let connection: GithubRedisConnection | undefined

  afterEach(async () => {
    await connection?.close()
    connection = undefined
  })

  it('reports no Redis and refuses a client when the worker has no URL', () => {
    connection = githubRedisOf({ url: undefined })

    expect(connection.isConfigured()).toBe(false)
    expect(() => connection?.client()).toThrow('REDIS_URL is not set')
    expect(() => connection?.duplicate()).toThrow('REDIS_URL is not set')
  })

  it('opens one lazy connection that answers once it connects', async () => {
    connection = githubRedisOf({ url: testRedisUrl })

    expect(connection.isConfigured()).toBe(true)
    expect(connection.client()).toBe(connection.client())
    expect(await connection.client().ping()).toBe('PONG')
  })

  it('duplicates the connection for a subscriber of its own', async () => {
    connection = githubRedisOf({ url: testRedisUrl })
    const duplicate = connection.duplicate()

    try {
      expect(duplicate).not.toBe(connection.client())
      await duplicate.connect()
      expect(await duplicate.ping()).toBe('PONG')
    } finally {
      await duplicate.quit()
    }
  })

  it('quits a connected client and leaves an untouched one alone', async () => {
    connection = githubRedisOf({ url: testRedisUrl })
    const untouched = githubRedisOf({ url: testRedisUrl })

    await connection.client().ping()
    await connection.close()
    await expect(untouched.close()).resolves.toBeUndefined()
    expect(connection.isConfigured()).toBe(true)
  })
})
