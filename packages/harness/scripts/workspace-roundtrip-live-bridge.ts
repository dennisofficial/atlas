import { Sandbox } from '@vercel/sandbox'

import { capturePortableState, createLocalCloudBridge, uploadWorkspaceArchive, VercelDriver } from '../src/index'
import type { LiveVercelCredentials } from './workspace-roundtrip-live-credentials'
import { MODEL_STUB } from './workspace-roundtrip-live-fixture'

const gzipFetch: typeof fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  headers.set('accept-encoding', 'gzip, deflate')
  return fetch(input, { ...init, headers })
}, { preconnect: fetch.preconnect })

const IMAGE = 'vercel/sandbox/universal:latest'

export function createLiveBridge(args: { credentials: LiveVercelCredentials; binary: string; token: string; home: string }) {
  let sandbox: Sandbox | undefined
  let teardown: Promise<void> | undefined
  const driver = new VercelDriver({
    credentials: args.credentials,
    cloudUrl: '',
    image: IMAGE,
    log: (line) => console.log(line),
    sdk: {
      get: (found) => Sandbox.get({ ...found, fetch: gzipFetch }),
      getOrCreate: async (made) => {
        const created = await Sandbox.getOrCreate({ ...made, fetch: gzipFetch })
        sandbox = created
        const prepare = await created.runCommand({ cmd: 'sh', args: ['-c', 'mkdir -p /opt/atlas; test ! -f /opt/atlas/atlas-serve.token'], timeoutMs: 15000 })
        if (prepare.exitCode !== 0) throw new Error('the probe sandbox was not fresh')
        await uploadWorkspaceArchive({ sandbox: created, source: args.binary, destination: '/opt/atlas/atlas-serve' })
        await created.runCommand({ cmd: 'chmod', args: ['755', '/opt/atlas/atlas-serve'], timeoutMs: 15000 })
        await created.writeFiles([{ path: '/opt/atlas/model-stub.js', content: MODEL_STUB, mode: 0o600 }])
        await created.runCommand({ cmd: 'sh', args: ['-c', 'exec bun /opt/atlas/model-stub.js > /opt/atlas/model-stub.log 2>&1'], detached: true })
        return created
      },
    },
  })
  const liveBridge = createLocalCloudBridge({
    vercel: () => ({ credentials: args.credentials, image: IMAGE }),
    attachmentToken: () => args.token,
    capturePortable: () => capturePortableState({ home: args.home }),
    driverWith: () => driver,
    environment: () => ({
      OPENROUTER_API_KEY: 'probe-placeholder-key',
      OPENROUTER_BASE_URL: 'http://127.0.0.1:3001',
      ATLAS_MODEL: 'openrouter/openai/gpt-4o-mini',
      ATLAS_CLASSIFIER_MODE: 'off',
      ATLAS_TELEMETRY_DISABLED: '1',
    }),
  })
  const bridge = {
    ...liveBridge,
    sandboxes: {
      ...liveBridge.sandboxes,
      destroy: (destroyArgs: Parameters<typeof liveBridge.sandboxes.destroy>[0]) => {
        teardown = liveBridge.sandboxes.destroy(destroyArgs)
        return teardown
      },
    },
  }
  return { driver, bridge, sandbox: () => sandbox, teardown: () => teardown }
}

export type LiveBridge = ReturnType<typeof createLiveBridge>['bridge']
