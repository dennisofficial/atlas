import { describe, expect, it } from 'bun:test'

import { driveNameFor, DRIVE_WORKSPACE_PATH, DRIVE_HOME_PATH, SERVE_TOKEN_PATH } from '@dltech/atlas-wire'
import { ECloudSandboxState } from '../sandbox-client'
import { CREDENTIALS, PINNED_VERSION, fakeSandbox, driverWith } from './vercel-driver-fixture'

describe('createOrResume', () => {
  it('creates with the operator credentials, the serve environment, and the fixed timeout', async () => {
    let seen: Record<string, unknown> = {}
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          seen = params as Record<string, unknown>
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
    })

    expect(seen).toMatchObject({
      ...CREDENTIALS,
      name: 'atlas-thread-x',
      ports: [3000],
      timeout: 4 * 60 * 60 * 1000,
      region: 'iad1',
      persistent: true,
      resume: true,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      env: {
        ATLAS_SERVE_TOKEN: 'serve-token-1',
        ATLAS_SERVE_PORT: '3000',
        ATLAS_THREAD_ID: 'brn_cloud',
        ATLAS_CLOUD_URL: 'https://api.example.com',
        ATLAS_WORKSPACE_DIR: DRIVE_WORKSPACE_PATH,
        ATLAS_HOME: DRIVE_HOME_PATH,
        VERCEL_TOKEN: CREDENTIALS.token,
        VERCEL_TEAM_ID: CREDENTIALS.teamId,
        VERCEL_PROJECT_ID: CREDENTIALS.projectId,
      },
    })
    expect(placement).toEqual({
      sessionId: 'session-1',
      url: 'https://sb-3000.vercel.run',
      state: ECloudSandboxState.Running,
      created: true,
      driveName: driveNameFor({ threadId: 'brn_cloud' }),
      token: 'serve-token-1',
    })
  })

  it('merges a caller environment into the sandbox env after the fixed entries', async () => {
    let seen: Record<string, unknown> = {}
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          seen = params as Record<string, unknown>
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
      environment: {
        ATLAS_DECISIONS_URL: 'https://api.typesafe.ai',
        ATLAS_CLASSIFIER_MODE: 'nudge',
        ATLAS_SEARCH_BACKEND: 'brave',
      },
    })

    expect(seen.env).toMatchObject({
      ATLAS_SERVE_TOKEN: 'serve-token-1',
      ATLAS_DECISIONS_URL: 'https://api.typesafe.ai',
      ATLAS_CLASSIFIER_MODE: 'nudge',
      ATLAS_SEARCH_BACKEND: 'brave',
    })
  })

  it('boots with no caller environment when none is handed', async () => {
    let seen: Record<string, unknown> = {}
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          seen = params as Record<string, unknown>
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
    })

    expect(seen.env).not.toHaveProperty('ATLAS_DECISIONS_URL')
  })

  it('hands the serve token to the sandbox through writeFiles and nothing larger', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 'serve-token-1',
    })

    expect(sandbox.written).toEqual([
      { path: SERVE_TOKEN_PATH, content: 'serve-token-1', mode: 0o600 },
    ])
  })

  it('mints the serve token on this machine when the caller hands none', async () => {
    const sandbox = fakeSandbox()
    let seen: Record<string, unknown> = {}
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          seen = params as Record<string, unknown>
          await params?.onCreate?.(sandbox)
          return sandbox
        },
      },
    })

    await driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud' })

    const minted = seen.env as Record<string, string>
    const token = minted.ATLAS_SERVE_TOKEN ?? ''
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(sandbox.written).toEqual([{ path: SERVE_TOKEN_PATH, content: token, mode: 0o600 }])
  })

  it('pins the model into the environment only when one is pinned', async () => {
    const seen: Record<string, unknown>[] = []
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          seen.push((params?.env ?? {}) as Record<string, unknown>)
          return fakeSandbox()
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      pinnedModel: 'anthropic/claude-opus-4.8',
    })
    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(seen[0]?.ATLAS_MODEL).toBe('anthropic/claude-opus-4.8')
    expect(seen[1]?.ATLAS_MODEL).toBeUndefined()
  })
})
