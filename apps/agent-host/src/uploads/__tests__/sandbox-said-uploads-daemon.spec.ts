import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { EUploadState, toThreadId, type SaidUpload } from '@dltech/atlas-core'
import {
  DaemonFileSystemPort,
  RemoteCalls,
  systemTimers,
  webSocketConnector,
} from '@dltech/atlas-host'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import { sandboxNameOf } from '../../sandbox/sandbox-provider'
import { startDaemon, type RigDaemon } from '../../testing/rig-daemon'
import { SandboxSaidUploads } from '../sandbox-said-uploads'

const SECRET = 'uploads-secret'
const SESSION = 'uploads-session'
const USER = 'user-1'
const ID = '0b9f3c1e-5d2a-4c8e-9a41-7e6d2f8b1a30'
const BYTES = Uint8Array.from([0, 1, 2, 250, 255, 10, 13])

describe('SandboxSaidUploads on the real daemon', () => {
  let daemon: RigDaemon
  let calls: RemoteCalls
  let server: ReturnType<typeof Bun.serve>

  beforeAll(async () => {
    server = Bun.serve({ port: 0, fetch: () => new Response(BYTES) })
    daemon = await startDaemon({ sessionId: SESSION, secret: SECRET })
    calls = new RemoteCalls({
      sessionId: SESSION,
      token: daemonToken({ secret: SECRET, sandboxName: sandboxNameOf(SESSION) }),
      connector: async () => webSocketConnector({ url: daemon.url }),
      timers: systemTimers,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()
  }, 30_000)

  afterAll(async () => {
    calls.close()
    await daemon.stop()
    await server.stop(true)
  })

  it('lands the blob bytes at <home>/uploads/<id>/<name> in the daemon filesystem', async () => {
    const upload: SaidUpload = {
      uploadId: ID,
      pathname: `composer-uploads/${USER}/${ID}/a.bin`,
      name: 'a.bin',
      size: BYTES.length,
      mediaType: 'application/octet-stream',
    }
    const uploads = new SandboxSaidUploads({
      userId: USER,
      home: daemon.home,
      files: new DaemonFileSystemPort({ calls }),
      blobs: {
        ready: async () => {},
        urlOf: async () => `http://127.0.0.1:${server.port}/blob`,
        sizeOf: async () => BYTES.length,
      },
    })

    const placed = await uploads.place({ threadId: toThreadId('t'), uploads: [upload] })

    const path = `${daemon.home}/uploads/${ID}/a.bin`
    expect(placed.get(ID)).toEqual({ state: EUploadState.Ready, path })
    expect(new Uint8Array(readFileSync(path))).toEqual(BYTES)
  })
})
