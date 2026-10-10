import { randomBytes } from 'node:crypto'

import { Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION, SWAP_LOCK_PATH } from '@dltech/atlas-wire'
import { VercelDriver } from '../src/index'
import { loadVercelCredentials } from './workspace-roundtrip-live-credentials'

const HELP = `swap-lock-live.ts — two-process concurrent wake race against a real Vercel sandbox.

  setup     create the throwaway sandbox with a deliberately stale serve stamp + live stub serve
  race      one wake attempt; run this from two processes at once
  inspect   read the sandbox's stamps, lock file, staging leftovers, and serve log tail
  destroy   delete the sandbox and its drive
`

const NAME = process.env['ATLAS_SWAP_LOCK_SANDBOX'] ?? ''
// Both races must agree on the thread identity or the second wake's serve boots for another thread.
const THREAD_ID = `swap-lock-probe-${(NAME === '' ? 'adhoc' : NAME.replace('atlas-swap-lock-', ''))}`
const IMAGE = 'vercel/sandbox/universal:latest'

const gzipFetch: typeof fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('accept-encoding', 'gzip, deflate')
    return fetch(input, { ...init, headers })
  },
  { preconnect: fetch.preconnect },
)

const liveSdk = {
  get: (args: Parameters<typeof Sandbox.get>[0]) => Sandbox.get({ ...args, fetch: gzipFetch }),
  getOrCreate: (args: Parameters<typeof Sandbox.getOrCreate>[0]) =>
    Sandbox.getOrCreate({ ...args, fetch: gzipFetch }),
}

const driver = async () => {
  const credentials = await loadVercelCredentials()
  return new VercelDriver({
    credentials,
    cloudUrl: '',
    image: IMAGE,
    // A real released pin, newer than the planted 0.0.1 stamp, so every wake rotates and the
    // install download actually resolves.
    serveVersion: '1.96.1',
    sdk: liveSdk,
    log: (line) => console.log(JSON.stringify({ phase: 'driver', pid: process.pid, line })),
  })
}

const setup = async () => {
  const credentials = await loadVercelCredentials()
  const name = NAME === '' ? `atlas-swap-lock-${randomBytes(4).toString('hex')}` : NAME
  console.log(JSON.stringify({ phase: 'creating', name }))
  const existing = await Sandbox.get({ ...credentials, name, fetch: gzipFetch }).catch(() => undefined)
  const sandbox =
    existing ??
    (await Sandbox.getOrCreate({
      ...credentials,
      name,
      image: IMAGE,
      ports: [3000],
      env: { ATLAS_THREAD_ID: THREAD_ID },
      fetch: gzipFetch,
    }))
  const sessionId = sandbox.currentSession().sessionId
  const idleHealth = {
    rotationPreparationVersion: 1,
    sandboxSessionId: sessionId,
    busy: false,
    turnRunning: false,
    childrenRunning: 0,
    shellsRunning: 0,
    servicesRunning: 0,
    pendingInput: false,
    settlingWork: false,
    clients: 0,
  }
  const drainReply = {
    ok: true,
    prepared: true,
    receipt: { sandboxSessionId: sessionId, preparedAt: '2026-10-10T00:00:00Z', version: 1 },
  }
  const asPython = (payload: unknown): string =>
    JSON.stringify(payload)
      .replaceAll('false', 'False')
      .replaceAll('true', 'True')
  const stubSource = `from http.server import BaseHTTPRequestHandler, HTTPServer
import json
IDLE = ${asPython(idleHealth)}
DRAIN = ${asPython(drainReply)}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self): self._json(IDLE)
    def do_POST(self): self._json(DRAIN)
HTTPServer(('127.0.0.1', 3000), H).serve_forever()
`
  const prepare = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      [
        'mkdir -p /opt/atlas',
        // A deliberately stale serve: older version, current wire protocol, so rotation drains it.
        'printf %s 0.0.1 > /opt/atlas/atlas-serve.version',
        `printf %s ${CHANNEL_PROTOCOL_VERSION} > /opt/atlas/atlas-serve.protocol`,
        'printf %s probe-token > /opt/atlas/atlas-serve.token',
      ].join(' && '),
    ],
    timeoutMs: 20_000,
  })
  if (prepare.exitCode !== 0) throw new Error('could not plant the stale stamp')
  await sandbox.writeFiles([{ path: '/opt/atlas/stub-serve.py', content: stubSource, mode: 0o755 }])
  const boot = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      'nohup python3 /opt/atlas/stub-serve.py > /opt/atlas/stub-serve.log 2>&1 & echo $! > /opt/atlas/atlas-serve.pid',
    ],
    timeoutMs: 20_000,
  })
  if (boot.exitCode !== 0) {
    throw new Error(`could not boot the stub serve: ${await boot.stderr()}`)
  }
  console.log(JSON.stringify({ phase: 'SETUP_DONE', name, threadId: THREAD_ID, sessionId }))
}

const race = async () => {
  if (NAME === '') throw new Error('ATLAS_SWAP_LOCK_SANDBOX must name the sandbox setup created')
  const startedAt = Date.now()
  const placed = await (await driver()).createOrResume({
    name: NAME,
    threadId: THREAD_ID,
    token: process.env['ATLAS_SWAP_LOCK_TOKEN'] ?? 'probe-token',
    environment: { ATLAS_THREAD_ID: THREAD_ID },
  })
  console.log(
    JSON.stringify({
      phase: 'RACE_DONE',
      pid: process.pid,
      ms: Date.now() - startedAt,
      sessionId: placed.sessionId,
      rotatedFrom: placed.rotatedFrom ?? null,
      rotatedProtocol: placed.rotatedProtocol ?? null,
      created: placed.created,
    }),
  )
}

const inspect = async () => {
  if (NAME === '') throw new Error('ATLAS_SWAP_LOCK_SANDBOX must name the sandbox')
  const credentials = await loadVercelCredentials()
  const sandbox = await Sandbox.get({ ...credentials, name: NAME, fetch: gzipFetch })
  const read = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-c',
      `printf 'version='; cat /opt/atlas/atlas-serve.version 2>/dev/null; printf '\\nprotocol='; cat /opt/atlas/atlas-serve.protocol 2>/dev/null; printf '\\nlock='; ls -la ${SWAP_LOCK_PATH} 2>/dev/null; printf '\\nstaging-leftovers='; ls /opt/atlas/atlas-serve.next* 2>/dev/null | wc -l; printf 'serve-pid-alive='; kill -0 $(cat /opt/atlas/atlas-serve.pid 2>/dev/null) 2>/dev/null && echo yes || echo no; printf 'log-tail:\\n'; tail -c 4000 /atlas/home/operational/atlas-serve.log 2>/dev/null || tail -c 4000 /opt/atlas/atlas-serve.log 2>/dev/null || true`,
    ],
    timeoutMs: 20_000,
  })
  console.log(await read.stdout())
}

const destroy = async () => {
  if (NAME === '') throw new Error('ATLAS_SWAP_LOCK_SANDBOX must name the sandbox')
  const credentials = await loadVercelCredentials()
  const sandbox = await Sandbox.get({ ...credentials, name: NAME, fetch: gzipFetch }).catch(
    () => undefined,
  )
  if (sandbox !== undefined) {
    await sandbox.delete({ signal: AbortSignal.timeout(30_000) })
    console.log(JSON.stringify({ phase: 'DESTROYED', name: NAME }))
    return
  }
  console.log(JSON.stringify({ phase: 'ALREADY_GONE', name: NAME }))
}

const command = process.argv[2]
if (command === 'setup') await setup()
else if (command === 'race') await race()
else if (command === 'inspect') await inspect()
else if (command === 'destroy') await destroy()
else {
  console.log(HELP)
  process.exit(1)
}
