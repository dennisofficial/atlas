import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toRunId, toThreadId } from '../../packages/core/src/index'
import {
  captureWorkspace,
  createRemoteDeltaChannel,
  EClientRequest,
  mergePublishedWorkspace,
  RemoteThreadStore,
  SessionsClient,
} from '../../packages/harness/src/index'
import { startServe } from '../../packages/harness/src/serve/index'
import { API, fail, log, PG_CONTAINER, SERVE_PORT, signUp } from './lib/setup.mjs'

const SERVE_URL = `http://localhost:${SERVE_PORT}`
const SANDBOX_TOKEN = `e2e-sandbox-ws-${Date.now()}`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const git = (cwd, ...args) => {
  const run = Bun.spawnSync(['git', ...args], { cwd })
  if (run.exitCode !== 0) fail(`git ${args.join(' ')}: ${run.stderr.toString()}`)
  return run.stdout.toString().trim()
}

const statusOf = (cwd) => git(cwd, 'status', '--porcelain')
const headOf = (cwd) => git(cwd, 'rev-parse', 'HEAD')
const refsIn = (remote) => git(remote, 'for-each-ref', '--format=%(refname)')

// A bare "origin" on the local filesystem stands in for GitHub: the serve clones from it and
// pushes the scratch ref to it, the operator's checkout fetches from it. No token is needed for
// a path remote, which is exactly what a user without a linked GitHub account produces.
const root = mkdtempSync(join(tmpdir(), 'e2e-cloud-ws-'))
const remote = join(root, 'remote.git')
const seed = join(root, 'seed')
const local = join(root, 'local')
const serveCwd = join(root, 'sandbox')
mkdirSync(serveCwd)

git(root, 'init', '--bare', '--initial-branch=main', remote)
git(root, 'init', '--initial-branch=main', seed)
writeFileSync(join(seed, 'app.txt'), 'alpha\nbeta\ngamma\n')
git(seed, 'add', '-A')
git(seed, '-c', 'user.name=E2E', '-c', 'user.email=e2e@rig.local', 'commit', '-m', 'lifted commit')
git(seed, 'remote', 'add', 'origin', remote)
git(seed, 'push', 'origin', 'HEAD:main')
const lifted = headOf(seed)

git(root, 'clone', '--', remote, local)
writeFileSync(join(local, 'app.txt'), 'alpha\nbeta\ngamma\nlifted local edit\n')
writeFileSync(join(local, 'notes.txt'), 'uncommitted at lift\n')

const captured = await captureWorkspace({ cwd: local })
if (captured === null || captured.commit !== lifted || captured.patch.length === 0) {
  fail('the lift capture did not see the uncommitted work')
}
log('lift capture sees the uncommitted work')

const { token: userToken, userId } = await signUp()
const client = new SessionsClient({ url: API, token: userToken, clientVersion: 'e2e' })
const threads = new RemoteThreadStore({ client })

const threadId = toThreadId(`brn_e2e-ws-${Date.now()}`)
await threads.createWithFirstEvents({
  runId: toRunId('run_e2e-ws-seed'),
  threadId,
  workspace: local,
  executionLocation: 'cloud',
  drafts: [{ type: 'user-said', text: 'seed' }],
})
log(`thread transferred up: ${threadId}`)

const tokenHash = createHash('sha256').update(SANDBOX_TOKEN).digest('hex')
const patchB64 = Buffer.from(captured.patch, 'utf8').toString('base64')
const sql = `INSERT INTO "CloudSandbox" (id, "threadId", "userId", "sandboxId", name, region, state, "lastActivityAt", "tokenHash", "workspaceRemoteUrl", "workspaceBranch", "workspaceCommit", "workspacePatch", "createdAt", "updatedAt") VALUES ('sbx_e2ews_${Date.now()}', '${threadId}', '${userId}', 'vsbx_e2ews', 'atlas-thread-e2ews', 'iad1', 'running', now(), '${tokenHash}', '${captured.remoteUrl}', '${captured.branch}', '${captured.commit}', convert_from(decode('${patchB64}', 'base64'), 'UTF8'), now(), now())`
const insert = Bun.spawnSync([
  'docker',
  'exec',
  PG_CONTAINER,
  'psql',
  'postgresql://postgres:postgres@localhost:5432/postgres',
  '-c',
  sql,
])
if (insert.exitCode !== 0) fail(`sandbox row insert: ${insert.stderr.toString()}`)
log('sandbox row minted with the workspace spec')

const serve = await startServe({
  threadId,
  port: SERVE_PORT,
  token: SANDBOX_TOKEN,
  controlPlaneUrl: API,
  cwd: serveCwd,
  model: 'openrouter/moonshotai/kimi-k3',
  env: { OPENROUTER_API_KEY: 'e2e-openrouter-key' },
  heartbeatIntervalMs: 60_000,
})

let healthy = false
for (let attempt = 0; attempt < 60; attempt++) {
  const probe = await fetch(`${SERVE_URL}/v1/health`, {
    headers: { authorization: `Bearer ${SANDBOX_TOKEN}` },
  }).catch(() => null)
  if (probe !== null && probe.status === 200) {
    healthy = true
    break
  }
  await sleep(500)
}
if (!healthy) fail('the serve never answered healthy')

const materializedApp = readFileSync(join(serveCwd, 'app.txt'), 'utf8')
if (!materializedApp.includes('lifted local edit')) {
  fail('the lifted patch never materialized in the sandbox')
}
if (readFileSync(join(serveCwd, 'notes.txt'), 'utf8') !== 'uncommitted at lift\n') {
  fail('the untracked file never materialized in the sandbox')
}
log('workspace materialized with the uncommitted work applied')

const channel = createRemoteDeltaChannel({
  threadId,
  url: SERVE_URL,
  token: SANDBOX_TOKEN,
  maxAttempts: 2,
  backoffMs: () => 50,
})

const publish = async () => {
  const published = await channel.request({ op: EClientRequest.PublishWorkspace, params: {} })
  if (published === null || published === undefined) return null
  return published
}

const mergeHome = async (published) =>
  mergePublishedWorkspace({ cwd: local, ref: published.ref, base: published.base })

if (headOf(serveCwd) === lifted) fail('the materialization never committed its baseline')
const first = await publish()
if (first !== null) fail(`an untouched sandbox published ${JSON.stringify(first)}`)
if (readFileSync(join(local, 'app.txt'), 'utf8') !== 'alpha\nbeta\ngamma\nlifted local edit\n') {
  fail('a no-op descend changed the local tree')
}
if (headOf(local) !== lifted) fail('the no-op descend moved HEAD')
log('leg 1: an untouched sandbox sends nothing home and the local tree is left alone')

writeFileSync(join(serveCwd, 'app.txt'), 'alpha\nbeta\ngamma\nlifted local edit\ncloud line\n')
writeFileSync(join(serveCwd, 'cloud-only.txt'), 'made in the sandbox\n')
const second = await publish()
if (second === null) fail('the second publish should carry the cloud work')
const secondMerge = await mergeHome(second)
if (secondMerge.conflicts.length !== 0) fail(`clean work reported conflicts: ${secondMerge.conflicts}`)
if (readFileSync(join(local, 'cloud-only.txt'), 'utf8') !== 'made in the sandbox\n') {
  fail('the cloud-made file never came home')
}
const afterSecond = readFileSync(join(local, 'app.txt'), 'utf8')
if (!afterSecond.includes('cloud line') || !afterSecond.includes('lifted local edit')) {
  fail(`the cloud edit and the lifted edit did not both land: ${afterSecond}`)
}
if (headOf(local) !== lifted) fail('the second merge moved HEAD')
if (statusOf(local) === '') fail('the landed work should be uncommitted, and is not')
if (refsIn(remote).includes(second.ref)) fail('the scratch ref survived the merge')
log('leg 2: cloud-only work lands locally as uncommitted changes, even appended after lifted lines')

writeFileSync(join(local, 'app.txt'), 'alpha local\ngamma\nlifted local edit\ncloud line\n')
writeFileSync(join(serveCwd, 'app.txt'), 'alpha cloud\nbeta\ngamma\nlifted local edit\ncloud line\n')
const third = await publish()
if (third === null) fail('the third publish should carry the overlapping edit')
const thirdMerge = await mergeHome(third)
if (thirdMerge.conflicts.length !== 1 || thirdMerge.conflicts[0] !== 'app.txt') {
  fail(`the overlap should conflict on app.txt, got: ${thirdMerge.conflicts}`)
}
const conflicted = readFileSync(join(local, 'app.txt'), 'utf8')
if (!conflicted.includes('<<<<<<<') || !conflicted.includes('alpha local') || !conflicted.includes('alpha cloud')) {
  fail(`the conflicted file holds no markers: ${conflicted}`)
}
if (headOf(local) !== lifted) fail('the conflicting merge moved HEAD')
log('leg 3: an overlapping edit degrades to conflict markers instead of a failed descend')

await serve.close()
channel.close()
console.log('WORKSPACE-DOWN PHASE GREEN')
process.exit(0)
