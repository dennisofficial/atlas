import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { ENoticeTone, EExecutionLocation, projectDirectoryOf, type NoticePost } from '@dltech/atlas-core'
import { cloudWorkspacePath } from '@dltech/atlas-wire'
import { captureWorkspaceMetadata, descendFromCloud, liftToCloud, type CloudChannel, type RestoredWorkspace } from '../src/index'
import { SERVE_LOG_PATH } from '@dltech/atlas-wire'
import { createLiveBridge } from './workspace-roundtrip-live-bridge'
import { editInCloud, captureBaseline, createUnrelatedCloudCheckout, inspectOwnedCloud, steerEveryTeammate, unrelatedCloudCheckoutRemains, verifyCloudThreads, verifyCloudTrees } from './workspace-roundtrip-live-cloud'
import { loadVercelCredentials } from './workspace-roundtrip-live-credentials'
import { FEATURE_KEY, filesAfterCloud } from './workspace-roundtrip-live-family'
import { liveFixture, liveGit } from './workspace-roundtrip-live-fixture'
import { assertNoCloudCheckoutOnHost, divergeHost, verifyEventIdentity, verifyHostArrival, verifyHostIndependence } from './workspace-roundtrip-live-host'
import { assertFiles } from './workspace-roundtrip-live-inspect'
import { ownedSpecs } from './workspace-roundtrip-live-placement'

if (process.env['ATLAS_LIVE_WORKSPACE_ROUNDTRIP'] !== '1') throw new Error('Set ATLAS_LIVE_WORKSPACE_ROUNDTRIP=1 to provision a disposable Vercel sandbox')
const probeUnrelatedCloud = process.env['ATLAS_PROBE_UNRELATED_CLOUD'] === '1'
const credentials = await loadVercelCredentials()
const fixture = await liveFixture()
process.env.ATLAS_HOME = fixture.home
const sessionToken = randomBytes(32).toString('hex')
const binary = process.env['ATLAS_PROBE_SERVE_BINARY'] ?? '/tmp/atlas-workspace-roundtrip-serve-linux'
const live = createLiveBridge({ credentials, binary, token: sessionToken, home: fixture.home })
const { bridge, driver } = live
const notices: NoticePost[] = []
let channel: CloudChannel | undefined
let restored: RestoredWorkspace | undefined
let completed = false
console.log(JSON.stringify({ phase: 'starting', directory: fixture.directory, threadId: fixture.threadId, threads: fixture.threadIds.length, unrelatedCloudMode: probeUnrelatedCloud }))

try {
  const baseline = await captureBaseline(fixture)
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
    open: async ({ attachment, restoredWorkspace }) => {
      restored = restoredWorkspace
      channel = attachment.channel
    },
  })
  if (!lifted.ok) throw new Error(`lift failed at ${lifted.step}: ${lifted.detail}`)
  channel = lifted.channel
  const sandbox = live.sandbox()
  if (sandbox === undefined || restored === undefined) throw new Error('no live sandbox or restored workspace')
  if (restored.repository !== cloudWorkspacePath({ sourcePath: fixture.repository })) throw new Error('the primary did not land in a named workspace')
  const paths = await verifyCloudTrees({ fixture, sandbox, restored, baseline })
  if (restored.cwd !== paths.get(FEATURE_KEY)) throw new Error('the lifted session did not land in its own feature checkout')
  console.log(JSON.stringify({ phase: 'cloud-state-preserved', checkouts: paths.size + 1 }))

  const remote = bridge.attach({ threadId: fixture.threadId, url: lifted.sandbox.url, token: lifted.sandbox.token })
  const readRemote = (threadId: typeof fixture.threadId) => remote.stores.log.readOwn({ threadId })
  try {
    await verifyCloudThreads({ fixture, restored, paths, readEvents: readRemote, where: 'cloud' })
    console.log(JSON.stringify({ phase: 'cloud-thread-placement-preserved', threads: fixture.threadIds.length }))
  } finally { remote.channel.close() }

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
  const rootLog = bridge.attach({ threadId: fixture.threadId, url: lifted.sandbox.url, token: lifted.sandbox.token })
  try {
    const events = await rootLog.stores.log.readOwn({ threadId: fixture.threadId })
    const result = events.findLast((event) => event.type === 'tool-result' && event.name === 'bash')
    if (result?.type !== 'tool-result' || !JSON.stringify(result.output).includes(restored.cwd)) throw new Error('the model did not execute bash in the cloud worktree')
    console.log(JSON.stringify({ phase: 'actual-cloud-tool-execution', output: result.output }))
    await steerEveryTeammate({ fixture, channel, paths, readEvents: (threadId) => rootLog.stores.log.readOwn({ threadId }) })
  } finally { rootLog.channel.close() }

  await editInCloud({ sandbox, paths, repository: restored.repository })
  const unrelated = probeUnrelatedCloud ? await createUnrelatedCloudCheckout({ sandbox, repository: restored.repository }) : undefined
  const cloudAfter = await inspectOwnedCloud({ fixture, sandbox, restored, paths })
  for (const spec of ownedSpecs(fixture)) assertFiles({ label: `cloud edited ${spec.key}`, actual: cloudAfter[spec.key]?.files ?? {}, expected: filesAfterCloud(spec) })
  await divergeHost(fixture)

  const opened = await descendFromCloud({
    threadId: fixture.threadId, target: EExecutionLocation.Host, midTurn: false,
    bridge, channel, localApp: fixture.local, placement: fixture.placement,
    surface: {
      notice: { notify: (post) => { notices.push(post); console.log(JSON.stringify({ phase: 'notice', tone: post.tone, text: post.text })) } },
      onBegin: ({ waves }) => console.log(JSON.stringify({ phase: 'descend-plan', waves: waves.map((wave) => wave.label) })),
      onNodeDone: (nodeId) => console.log(JSON.stringify({ phase: 'descend', node: nodeId })),
      openLocal: async (home) => ({ cwd: home.workspace.workspace }),
    },
  })
  const located = await verifyHostArrival({ fixture, baseline, cloudAfter })
  if (opened.cwd === fixture.worktree || opened.cwd !== located.get(FEATURE_KEY) || !/feature-[0-9a-f]{4}$/.test(opened.cwd)) throw new Error(`the conflict did not create a suffixed worktree: ${opened.cwd}`)
  if (await readFile(join(opened.cwd, 'file.txt'), 'utf8') !== 'unstaged cloud\n') throw new Error('cloud physical files were lost')
  if (await liveGit({ cwd: opened.cwd, args: ['show', ':file.txt'] }) !== 'staged local') throw new Error('the staged index was lost')
  if (await readFile(join(opened.cwd, 'ignored.txt'), 'utf8') !== 'ignored local\n') throw new Error('the ignored file was lost')
  await verifyEventIdentity({ fixture, baseline })
  await verifyHostIndependence({ fixture, baseline })
  console.log(JSON.stringify({ phase: 'family-arrival-verified', checkouts: located.size, repository: basename(fixture.repository) }))
  await liveGit({ cwd: fixture.repository, args: ['fsck', '--no-dangling'] })
  const teardown = live.teardown()
  if (unrelated !== undefined) {
    if (teardown !== undefined) throw new Error('descend destroyed a sandbox holding an unrelated checkout')
    if (!notices.some((post) => post.tone === ENoticeTone.Warn)) throw new Error('no persistent retention warning was raised')
    if (await driver.inspect({ name: sandbox.name }) === undefined) throw new Error('the retained sandbox disappeared')
    if (!await unrelatedCloudCheckoutRemains({ sandbox, ...unrelated })) throw new Error('the unrelated cloud checkout is not intact')
    await assertNoCloudCheckoutOnHost({ fixture, marker: 'unrelated.txt' })
    console.log(JSON.stringify({ phase: 'UNRELATED_CLOUD_RETAINED_PASSED', name: sandbox.name, cwd: opened.cwd, directory: fixture.directory }))
  } else {
    if (teardown === undefined) throw new Error('descend did not schedule sandbox cleanup')
    await teardown
    if (await driver.inspect({ name: sandbox.name }) !== undefined) throw new Error('the sandbox still exists after cleanup')
    console.log(JSON.stringify({ phase: 'ephemeral-sandbox-and-drive-deleted', name: sandbox.name }))
    console.log(JSON.stringify({ phase: 'LIVE_ROUNDTRIP_PASSED', cwd: opened.cwd, directory: fixture.directory }))
  }
  completed = true
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  const sandbox = live.sandbox()
  if (sandbox !== undefined) {
    const logs = await sandbox.runCommand({ cmd: 'sh', args: ['-c', `tail -c 16000 ${SERVE_LOG_PATH}; tail -c 4000 /opt/atlas/model-stub.log`], timeoutMs: 15000 }).catch(() => undefined)
    if (logs !== undefined) console.error(await logs.stdout())
  }
  process.exitCode = 1
} finally {
  channel?.close()
  const sandbox = live.sandbox()
  if (sandbox !== undefined && (!completed || probeUnrelatedCloud)) {
    const observed = await driver.inspect({ name: sandbox.name }).catch(() => null)
    const phase = observed === undefined ? 'probe-sandbox-deleted' : observed === null ? 'probe-cleanup-unknown' : 'probe-sandbox-retained'
    console.log(JSON.stringify({ phase, name: sandbox.name, directory: fixture.directory }))
  }
}
process.exit(completed ? 0 : 1)
