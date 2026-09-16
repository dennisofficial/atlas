import { afterEach, describe, expect, it } from 'bun:test'

import { dockerUnavailableReason, LIVE_DOCKER_ENV } from './live-docker'

const MISSING_SOCKET = '/tmp/atlas-dev-no-such-docker.sock'

describe('live docker opt-in gate', () => {
  const original = process.env[LIVE_DOCKER_ENV]

  afterEach(() => {
    if (original === undefined) {
      delete process.env[LIVE_DOCKER_ENV]
    } else {
      process.env[LIVE_DOCKER_ENV] = original
    }
  })

  it('refuses before touching the socket when not opted in', async () => {
    delete process.env[LIVE_DOCKER_ENV]
    const reason = await dockerUnavailableReason(MISSING_SOCKET)
    expect(reason).toContain(LIVE_DOCKER_ENV)
  })

  it('falls through to the socket check when opted in', async () => {
    process.env[LIVE_DOCKER_ENV] = '1'
    const reason = await dockerUnavailableReason(MISSING_SOCKET)
    expect(reason).toBeDefined()
    expect(reason).not.toContain(LIVE_DOCKER_ENV)
  })
})
