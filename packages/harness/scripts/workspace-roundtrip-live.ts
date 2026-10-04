import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Sandbox } from '@vercel/sandbox'

import { EExecutionLocation, projectDirectoryOf } from '@dltech/atlas-core'
import {
  capturePortableState, captureWorkspaceMetadata, createLocalCloudBridge, descendFromCloud,
  FileSecretsStore, liftToCloud, SecretCipher, uploadWorkspaceArchive, VercelDriver,
  type CloudChannel,
} from '../src/index'
import { liveFixture, liveGit, MODEL_STUB } from './workspace-roundtrip-live-fixture'

if (process.env['ATLAS_LIVE_WORKSPACE_ROUNDTRIP'] !== '1') throw new Error('Set ATLAS_LIVE_WORKSPACE_ROUNDTRIP=1 to provision a disposable Vercel sandbox')
const realHome = join(homedir(), '.atlas')
const settings = JSON.parse(await readFile(join(realHome, 'settings.json'), 'utf8')) as Record<string, string>
const token = new FileSecretsStore({ file: join(realHome, 'secrets.json'), cipher: new SecretCipher(join(realHome, 'key')) }).read('sandbox.vercelToken')
const teamId = settings['sandbox.vercelTeamId']
const projectId = settings['sandbox.vercelProjectId']
if (token === undefined || teamId === undefined || projectId === undefined) throw new Error('Vercel is not configured')
const credentials = { token, teamId, projectId }
const gzipFetch: typeof fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  headers.set('accept-encoding', 'gzip, deflate')
  return fetch(input, { ...init, headers })
}, { preconnect: fetch.preconnect })
const fixture = await liveFixture()
process.env.ATLAS_HOME = fixture.home
const sessionToken = randomBytes(32).toString('hex')
const binary = process.env['ATLAS_PROBE_SERVE_BINARY'] ?? '/tmp/atlas-workspace-roundtrip-serve-linux'
let sandbox: Sandbox | undefined
let channel: CloudChannel | undefined
let completed = false
console.log(JSON.stringify({ phase: 'starting', directory: fixture.directory, threadId: fixture.threadId }))
const driver = new VercelDriver({
  credentials,
  cloudUrl: '',
  image: 'vercel/sandbox/universal:latest',
  log: (line) => console.log(line),
  sdk: {
    get: (args) => Sandbox.get({ ...args, fetch: gzipFetch }),
    getOrCreate: async (args) => {
      const made = await Sandbox.getOrCreate({ ...args, fetch: gzipFetch })
      sandbox = made
      const prepare = await made.runCommand({ cmd: 'sh', args: ['-c', 'mkdir -p /opt/atlas; test ! -f /opt/atlas/atlas-serve.token'], timeoutMs: 15000 })
      if (prepare.exitCode !== 0) throw new Error('the probe sandbox was not fresh')
      await uploadWorkspaceArchive({ sandbox: made, source: binary, destination: '/opt/atlas/atlas-serve' })
      await made.runCommand({ cmd: 'chmod', args: ['755', '/opt/atlas/atlas-serve'], timeoutMs: 15000 })
      await made.writeFiles([{ path: '/opt/atlas/model-stub.js', content: MODEL_STUB, mode: 0o600 }])
      await made.runCommand({ cmd: 'sh', args: ['-c', 'exec bun /opt/atlas/model-stub.js > /opt/atlas/model-stub.log 2>&1'], detached: true })
      return made
    },
  },
})
const bridge = createLocalCloudBridge({
  vercel: () => ({ credentials, image: 'vercel/sandbox/universal:latest' }),
  attachmentToken: () => sessionToken,
  capturePortable: () => capturePortableState({ home: fixture.home }),
  driverWith: () => driver,
  environment: () => ({
    OPENROUTER_API_KEY: 'probe-placeholder-key',
    OPENROUTER_BASE_URL: 'http://127.0.0.1:3001',
    ATLAS_MODEL: 'openrouter/openai/gpt-4o-mini',
    ATLAS_CLASSIFIER_MODE: 'off',
    ATLAS_TELEMETRY_DISABLED: '1',
  }),
})

try {
  const lifted = await liftToCloud({
    threadId: fixture.threadId, cwd: fixture.worktree, started: true, midTurn: false,
    interrupt: () => undefined, whenSettled: async () => undefined,
    identity: fixture.local.workspace, title: 'Direct workspace roundtrip probe',
    model: { ref: 'openrouter/openai/gpt-4o-mini', effort: 'medium' },
    bridge, localThreads: fixture.local.threads, localLog: fixture.local.log,
    agents: fixture.local.agents, ids: fixture.local.ids, placement: fixture.placement,
    stopLocal: async () => ({ shells: [], services: [], drainNotices: () => [] }),
    capture: captureWorkspaceMetadata, captureGpg: async () => null,
    captureContext: async () => undefined,
    onBegin: ({ waves }) => console.log(JSON.stringify({ phase: 'lift-plan', waves: waves.map((wave) => wave.label) })),
    onNodeDone: (nodeId) => console.log(JSON.stringify({ phase: 'lift', node: nodeId })),
    open: async ({ attachment }) => {
      channel = attachment.channel
      const events = await attachment.stores.log.readOwn({ threadId: fixture.threadId })
      console.log(JSON.stringify({ phase: 'prepared', cwd: projectDirectoryOf({ events, launchDirectory: '/atlas/workspace' }) }))
    },
  })
  if (!lifted.ok) throw new Error(`lift failed at ${lifted.step}: ${lifted.detail}`)
  channel = lifted.channel
  const live = sandbox
  if (live === undefined) throw new Error('no live sandbox')
  const remotePath = '/atlas/workspace/.atlas/worktrees/feature'
  const verifyRemote = await live.runCommand({ cmd: 'python3', args: ['-c', `import pathlib,subprocess,json
p=pathlib.Path(${JSON.stringify(remotePath)})
print(json.dumps({"file":(p/"file.txt").read_text(),"index":subprocess.check_output(["git","-C",str(p),"show",":file.txt"]).decode(),"ignored":(p/"ignored.txt").read_text()}))`], timeoutMs: 15000 })
  const remote = JSON.parse(await verifyRemote.stdout()) as { file: string; index: string; ignored: string }
  if (remote.file !== 'unstaged local\n' || remote.index !== 'staged local\n' || remote.ignored !== 'ignored local\n') throw new Error('dirty and staged state did not reach the cloud')
  console.log(JSON.stringify({ phase: 'cloud-state-preserved', ...remote }))

  const turn = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('the model probe turn timed out')), 60000)
    const off = channel?.onTurnEnded((outcome) => {
      clearTimeout(timeout); off?.()
      if (outcome.status === 'failed') reject(new Error(outcome.message))
      else resolve()
    })
  })
  channel.send({ text: 'Verify the current directory and dirty Git status with one bash call.' })
  await turn
  const remoteLog = bridge.attach({ threadId: fixture.threadId, url: lifted.sandbox.url, token: lifted.sandbox.token })
  try {
    const events = await remoteLog.stores.log.readOwn({ threadId: fixture.threadId })
    const result = events.findLast((event) => event.type === 'tool-result' && event.name === 'bash')
    if (result?.type !== 'tool-result' || !JSON.stringify(result.output).includes(remotePath)) throw new Error('the model did not execute bash in the cloud worktree')
    console.log(JSON.stringify({ phase: 'actual-cloud-tool-execution', output: result.output }))
  } finally { remoteLog.channel.close() }

  const edit = await live.runCommand({ cmd: 'python3', args: ['-c', `import pathlib,subprocess
repo=pathlib.Path("/atlas/workspace");p=repo/".atlas/worktrees/feature"
(p/"file.txt").write_text("unstaged cloud\\n");(p/"cloud-only.txt").write_text("cloud untracked\\n")
new=repo/".atlas/worktrees/cloud-created"
subprocess.run(["git","-C",str(repo),"worktree","add","-b","cloud-created",str(new)],check=True)
(new/"new.txt").write_text("cloud-created dirty\\n")`], timeoutMs: 15000 })
  if (edit.exitCode !== 0) throw new Error(await edit.stderr())
  await writeFile(join(fixture.repository, 'host-independent.txt'), 'host main stays\n')
  await writeFile(join(fixture.worktree, 'file.txt'), 'host independent feature\n')

  const opened = await descendFromCloud({
    threadId: fixture.threadId, target: EExecutionLocation.Host, midTurn: false,
    bridge, channel, localApp: fixture.local, placement: fixture.placement,
    surface: {
      notice: { notify: (post) => console.log(JSON.stringify({ phase: 'notice', text: post.text })) },
      onBegin: ({ waves }) => console.log(JSON.stringify({ phase: 'descend-plan', waves: waves.map((wave) => wave.label) })),
      onNodeDone: (nodeId) => console.log(JSON.stringify({ phase: 'descend', node: nodeId })),
      openLocal: async (home) => ({ cwd: home.workspace.workspace }),
    },
  })
  if (opened.cwd === fixture.worktree || !/feature-[0-9a-f]{4}$/.test(opened.cwd)) throw new Error(`the conflict did not create a suffixed worktree: ${opened.cwd}`)
  if (await readFile(join(opened.cwd, 'file.txt'), 'utf8') !== 'unstaged cloud\n') throw new Error('cloud physical files were lost')
  if (await liveGit({ cwd: opened.cwd, args: ['show', ':file.txt'] }) !== 'staged local') throw new Error('the staged index was lost')
  if (await readFile(join(opened.cwd, 'ignored.txt'), 'utf8') !== 'ignored local\n') throw new Error('the ignored file was lost')
  if (await readFile(join(fixture.worktree, 'file.txt'), 'utf8') !== 'host independent feature\n') throw new Error('the original host checkout was overwritten')
  if (await readFile(join(fixture.repository, 'host-independent.txt'), 'utf8') !== 'host main stays\n') throw new Error('host main was overwritten')
  const newTree = join(fixture.repository, '.atlas', 'worktrees', 'cloud-created')
  if (await readFile(join(newTree, 'new.txt'), 'utf8') !== 'cloud-created dirty\n') throw new Error('the cloud-created worktree was lost')
  await liveGit({ cwd: fixture.repository, args: ['fsck', '--no-dangling'] })
  completed = true
  console.log(JSON.stringify({ phase: 'LIVE_ROUNDTRIP_PASSED', cwd: opened.cwd, directory: fixture.directory }))
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  if (sandbox !== undefined) {
    const logs = await sandbox.runCommand({ cmd: 'sh', args: ['-c', 'tail -c 16000 /opt/atlas/atlas-serve.log; tail -c 4000 /opt/atlas/model-stub.log'], timeoutMs: 15000 }).catch(() => undefined)
    if (logs !== undefined) console.error(await logs.stdout())
  }
  process.exitCode = 1
} finally {
  channel?.close()
  if (!completed && sandbox !== undefined) console.log(JSON.stringify({ phase: 'probe-sandbox-retained', name: sandbox.name, directory: fixture.directory }))
}
process.exit(completed ? 0 : 1)
