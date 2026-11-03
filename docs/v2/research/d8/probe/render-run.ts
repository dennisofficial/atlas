import { readFileSync, writeFileSync } from 'node:fs'
import { Sandbox } from '@vercel/sandbox'

const TEAM_ID = 'team_GR4aCzLIY5D3YYWgITz3Tere'
const PROJECT_ID = 'prj_sYzDU4qVdx0jaSuYprH3QaZb1vIF'
const NAME = `d8-rtt-render-${Date.now()}`
const PORT = 3000
const GREP_ROOT = '/tmp/gtree'
const N_SEQ = 200
const N_SDK = 30
const N_HTTPS = 50
const N_CONNECT = 3
const API_HEALTH_URL = process.env.API_HEALTH_URL ?? 'https://api.byatlas.io/v1/health'

type Sample = { op: string; kind: string; ms: number }
const samples: Sample[] = []
const report: Record<string, unknown> = { sandbox: NAME, source: 'render' }

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN
}
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: +pct(xs, 50).toFixed(2),
  p90: +pct(xs, 90).toFixed(2),
  p99: +pct(xs, 99).toFixed(2),
  min: +Math.min(...xs).toFixed(2),
  max: +Math.max(...xs).toFixed(2),
  mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2),
})

function log(s: string) {
  console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${s}`)
}
const t0 = performance.now()

async function httpsBaseline() {
  log(`HTTPS GET baseline: ${N_HTTPS} x GET ${API_HEALTH_URL}…`)
  try {
    const warm = await fetch(API_HEALTH_URL, { signal: AbortSignal.timeout(10000) })
    await warm.arrayBuffer()
    report.apiHealthStatus = warm.status
    for (let i = 0; i < N_HTTPS; i++) {
      const t = performance.now()
      const r = await fetch(API_HEALTH_URL, { signal: AbortSignal.timeout(10000) })
      await r.arrayBuffer()
      samples.push({ op: 'health', kind: 'https', ms: performance.now() - t })
    }
    log('HTTPS baseline done')
  } catch (err) {
    report.httpsBaselineError = String(err)
    log(`HTTPS baseline FAILED: ${String(err)}`)
  }
}

async function openWs(url: string): Promise<{ ws: WebSocket; ms: number }> {
  const tWs = performance.now()
  const ws = new WebSocket(url.replace(/^https:/, 'wss:'))
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('ws error'))
    setTimeout(() => reject(new Error('ws open timeout 20s')), 20000)
  })
  return { ws, ms: +(performance.now() - tWs).toFixed(2) }
}

let sandbox: Sandbox | undefined
try {
  const creds = { token: process.env.VERCEL_TOKEN!, teamId: TEAM_ID, projectId: PROJECT_ID }

  await httpsBaseline()

  log('creating sandbox…')
  const tCreate = performance.now()
  sandbox = await Sandbox.create({
    ...creds,
    name: NAME,
    image: 'comp-ai/atlas-web/atlas-sandbox:latest',
    ports: [PORT],
    timeout: 15 * 60 * 1000,
    region: 'iad1',
  })
  report.createMs = +(performance.now() - tCreate).toFixed(1)
  report.configuredRegion = sandbox.region
  report.actualRegion = sandbox.currentSession().region
  report.sandboxId = sandbox.sandboxId
  log(
    `created ${sandbox.sandboxId} region=${report.configuredRegion} actual=${report.actualRegion} in ${report.createMs}ms`,
  )

  const url = sandbox.domain(PORT)
  report.domain = url
  log(`domain: ${url}`)

  log('uploading ws-server.ts…')
  await sandbox.writeFiles([
    {
      path: '/tmp/ws-server.ts',
      content: Buffer.from(readFileSync(new URL('./render-ws-server.ts', import.meta.url))),
    },
  ])
  log('building ~2k-file grep tree + starting server (detached)…')
  const bunProbe = await sandbox.runCommand('bash', [
    '-lc',
    'for p in /opt/mise/shims/bun "$(command -v bun)" /usr/local/bin/bun; do [ -n "$p" ] && [ -x "$p" ] && echo "$p" && break; done',
  ])
  const bunPath = (await bunProbe.stdout()).trim()
  await bunProbe.wait()
  report.bunPath = bunPath
  log(`bun in sandbox: ${bunPath}`)
  if (!bunPath) throw new Error('no bun in sandbox image')

  const setupCmd = [
    'mkdir -p /tmp/gtree/sub{a..z}/dir{0..9}',
    'for d in /tmp/gtree/sub?/dir*; do for i in $(seq 1 8); do echo "file $i in $d with some searchable content line $RANDOM" > "$d/f$i.txt"; done; done',
    'find /tmp/gtree -type f | wc -l',
  ].join(' && ')
  const setup = await sandbox.runCommand('bash', ['-lc', setupCmd])
  const setupOut = await setup.stdout()
  await setup.wait()
  report.treeFileCount = Number(setupOut.trim())
  log(`grep tree files: ${report.treeFileCount}`)

  const srv = await sandbox.runCommand('bash', [
    '-lc',
    `nohup ${bunPath} /tmp/ws-server.ts > /tmp/ws-server.log 2>&1 & echo started; sleep 1; head -c 200 /tmp/ws-server.log`,
  ])
  log('server start: ' + (await srv.stdout()))
  await srv.wait()

  let up = false
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (r.status === 426) {
        up = true
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  report.serverReachable = up
  log(`server reachable over proxy: ${up}`)
  if (!up) throw new Error('server never became reachable')

  const connectSamples: number[] = []
  for (let i = 0; i < N_CONNECT; i++) {
    const { ws: probeWs, ms } = await openWs(url)
    connectSamples.push(ms)
    log(`ws fresh connect ${i + 1}/${N_CONNECT}: ${ms}ms`)
    probeWs.close()
  }
  report.wsConnectSamplesMs = connectSamples

  log('opening measurement WebSocket…')
  const { ws } = await openWs(url)
  report.wsConnectMs = connectSamples[0]
  log('measurement ws connected')

  const pending = new Map<number, { resolve: (out: string) => void; t: number; op: string }>()
  let nextId = 1
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data))
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    samples.push({ op: p.op, kind: 'ws', ms: performance.now() - p.t })
    p.resolve(msg.out ?? '')
  }
  const wsCall = (op: string, payload: Record<string, unknown>): Promise<string> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, t: performance.now(), op })
      ws.send(JSON.stringify({ id, op, ...payload }))
      setTimeout(() => reject(new Error(`ws call ${id} timeout`)), 30000)
    })

  for (let i = 0; i < 5; i++) await wsCall('ping', {})

  const execCmd = ['bash', '-lc', 'echo hello-$((1+1))']
  const readPath = 'suba/dir0/f1.txt'
  const writePath = 'subz/dir9/f8.txt'
  const grepPattern = 'searchable'

  log(`WS sequential: ${N_SEQ} per op…`)
  for (let i = 0; i < N_SEQ; i++) {
    await wsCall('exec', { cmd: execCmd })
    await wsCall('read', { path: readPath })
    await wsCall('write', { path: writePath, data: `payload-${i}-${'x'.repeat(256)}` })
    await wsCall('grep', { pattern: grepPattern })
  }
  log('WS sequential done')

  log('holding WS idle for ~3 min…')
  const tIdle = performance.now()
  await new Promise((r) => setTimeout(r, 3 * 60 * 1000))
  const idleAlive = ws.readyState === WebSocket.OPEN
  report.idleHold = { idleMs: +(performance.now() - tIdle).toFixed(0), openAfter: idleAlive }
  if (idleAlive) {
    const tPing = performance.now()
    const pong = await wsCall('ping', {})
    report.idleHold.pingAfterIdleMs = +(performance.now() - tPing).toFixed(2)
    report.idleHold.pong = pong
    log(`idle hold ok, ping after idle: ${report.idleHold.pingAfterIdleMs}ms`)
  } else {
    log('WS DROPPED during idle hold')
  }

  log(`runCommand per-call: ${N_SDK} per op…`)
  for (let i = 0; i < N_SDK; i++) {
    {
      const t = performance.now()
      const c = await sandbox.runCommand('bash', ['-lc', 'echo hello-$((1+1))'])
      await c.stdout()
      await c.wait()
      samples.push({ op: 'exec', kind: 'sdk', ms: performance.now() - t })
    }
    {
      const t = performance.now()
      const c = await sandbox.runCommand('bash', ['-lc', `cat ${GREP_ROOT}/${readPath}`])
      await c.stdout()
      await c.wait()
      samples.push({ op: 'read', kind: 'sdk', ms: performance.now() - t })
    }
    {
      const t = performance.now()
      const c = await sandbox.runCommand('bash', [
        '-lc',
        `printf 'payload-%s' ${i} > ${GREP_ROOT}/${writePath}`,
      ])
      await c.stdout()
      await c.wait()
      samples.push({ op: 'write', kind: 'sdk', ms: performance.now() - t })
    }
    {
      const t = performance.now()
      const c = await sandbox.runCommand('bash', [
        '-lc',
        `rg --files-with-matches ${grepPattern} ${GREP_ROOT}`,
      ])
      await c.stdout()
      await c.wait()
      samples.push({ op: 'grep', kind: 'sdk', ms: performance.now() - t })
    }
    if (i % 10 === 9) log(`sdk ${i + 1}/${N_SDK}`)
  }

  ws.close()
} catch (err) {
  report.error = String(err)
  log('ERROR: ' + String(err))
} finally {
  const results: Record<string, unknown> = {}
  for (const kind of ['ws', 'sdk', 'https']) {
    for (const op of ['exec', 'read', 'write', 'grep', 'health']) {
      const xs = samples.filter((s) => s.kind === kind && s.op === op).map((s) => s.ms)
      if (xs.length) results[`${kind}.${op}`] = stats(xs)
    }
  }
  report.results = results
  report.localBaseline = 'dropped: Render box is not the perf subject; kept identical ws/sdk paths'

  try {
    writeFileSync('results-render.json', JSON.stringify(report, null, 2))
  } catch {}
  console.log(`RESULTS_JSON ${JSON.stringify(report)}`)

  if (sandbox) {
    log('stopping sandbox…')
    try {
      await sandbox.stop()
      report.stopped = true
      console.log(`RESULTS_JSON_FINAL ${JSON.stringify(report)}`)
      log('stopped')
    } catch (err) {
      log('sandbox stop FAILED: ' + String(err))
    }
  }
}
