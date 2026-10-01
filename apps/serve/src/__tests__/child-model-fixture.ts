import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import {
  buildHarness,
  createRemoteDeltaChannel,
  RemoteThreadStore,
  scriptedModel,
  type RemoteDeltaChannel,
} from '@dltech/atlas-harness'

import { EWorkspaceState, startServe } from '../index'
import { fakeServeApp } from './fakes'

export const ORIGINAL = { ref: 'anthropic/claude-sonnet-4-5', effort: 'medium' }
export const PICKED = { ref: 'openai/gpt-5-codex', effort: 'high' }

export async function openChildModelServe() {
  const home = mkdtempSync(join(tmpdir(), 'atlas-child-model-wire-'))
  const harness = await buildHarness({ home, model: scriptedModel({ script: [] }) })
  const root = await harness.threads.create({ id: toThreadId('served-root'), model: ORIGINAL })
  const teammate = await harness.threads.create({
    agent: { spawnedBy: root.id, type: 'teammate' },
    model: ORIGINAL,
  })
  const child = await harness.threads.create({
    agent: { spawnedBy: teammate.id, type: 'explore' },
    model: ORIGINAL,
  })
  const selected: { ref: string; effort: string }[] = []
  const app = fakeServeApp({ threadId: root.id, root: '/workspace' })
  const serve = await startServe({
    threadId: root.id,
    port: 0,
    token: 'child-model-session',
    controlPlaneUrl: 'https://api.example.com',
    env: { ATLAS_HOME: home },
    cwd: '/workspace',
    compose: async () => ({
      ...app,
      threads: harness.threads,
      log: harness.log,
      ledger: harness.ledger,
      modelBridge: { effort: () => 'medium', select: (next) => void selected.push(next) },
    }),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  const channels: RemoteDeltaChannel[] = []
  const connect = async () => {
    const channel = createRemoteDeltaChannel({
      threadId: root.id,
      url: `http://127.0.0.1:${serve.port}`,
      token: 'child-model-session',
      maxAttempts: 0,
    })
    channels.push(channel)
    await new Promise<void>((resolve, reject) => {
      const offReady = channel.onReady(() => {
        offReady()
        offError()
        resolve()
      })
      const offError = channel.onError(({ message }) => reject(new Error(message)))
    })
    return { channel, threads: new RemoteThreadStore({ channel }) }
  }

  return {
    root,
    teammate,
    child,
    harness,
    home,
    selected,
    connect,
    close: async () => {
      for (const channel of channels) channel.close()
      await serve.close()
      await harness.close()
      rmSync(home, { recursive: true, force: true })
    },
  }
}
