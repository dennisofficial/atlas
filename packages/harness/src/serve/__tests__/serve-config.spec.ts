import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import {
  DEFAULT_SERVE_PORT,
  EServeEnv,
  ServeNeedsConfiguration,
  serveConfig,
} from '../serve-config'

const injected = {
  [EServeEnv.Token]: 'session-token',
  [EServeEnv.Port]: '3000',
  [EServeEnv.ThreadId]: 'thread-serve',
  [EServeEnv.CloudUrl]: 'https://api.example.com',
}

describe('serveConfig', () => {
  it('reads what the sandbox was created with', () => {
    expect(serveConfig({ env: injected })).toEqual({
      threadId: toThreadId('thread-serve'),
      port: 3000,
      token: 'session-token',
      controlPlaneUrl: 'https://api.example.com',
      cwd: process.cwd(),
    })
  })

  it('serves the workspace directory the sandbox was told to hold it in', () => {
    const told = { ...injected, [EServeEnv.WorkspaceDir]: '/vercel/sandbox/workspace' }

    expect(serveConfig({ env: told }).cwd).toBe('/vercel/sandbox/workspace')
    expect(serveConfig({ env: told, cwd: '/given' }).cwd).toBe('/given')
  })

  it('lets an explicit argument win over the environment', () => {
    const config = serveConfig({ env: injected, port: 0, token: 'given' })

    expect(config.port).toBe(0)
    expect(config.token).toBe('given')
  })

  it('listens on the agreed port when the environment names none', () => {
    const { [EServeEnv.Port]: _port, ...rest } = injected

    expect(serveConfig({ env: rest }).port).toBe(DEFAULT_SERVE_PORT)
  })

  it('names the variable it is missing, never the value it wanted', () => {
    const { [EServeEnv.Token]: _token, ...rest } = injected

    try {
      serveConfig({ env: rest })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ServeNeedsConfiguration)
      expect((error as ServeNeedsConfiguration).variable).toBe(EServeEnv.Token)
      expect((error as Error).message).toContain(EServeEnv.Token)
    }
  })

  it('refuses a thread it was not given and a cloud url it was not given', () => {
    const { [EServeEnv.ThreadId]: _thread, ...noThread } = injected
    const { [EServeEnv.CloudUrl]: _url, ...noUrl } = injected

    expect(() => serveConfig({ env: noThread })).toThrow(ServeNeedsConfiguration)
    expect(() => serveConfig({ env: noUrl })).toThrow(ServeNeedsConfiguration)
  })

  it('refuses a port that is not a port', () => {
    expect(() => serveConfig({ env: { ...injected, [EServeEnv.Port]: 'http' } })).toThrow(
      ServeNeedsConfiguration,
    )
    expect(() => serveConfig({ env: { ...injected, [EServeEnv.Port]: '70000' } })).toThrow(
      ServeNeedsConfiguration,
    )
  })

  it('reads an empty variable as one that was never set', () => {
    expect(() => serveConfig({ env: { ...injected, [EServeEnv.Token]: '  ' } })).toThrow(
      ServeNeedsConfiguration,
    )
  })
})
