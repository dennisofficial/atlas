import { Sandbox, Snapshot } from '@vercel/sandbox'

const RUN = Date.now()
const NAME = `atlas-snapshot-probe-${RUN}`
const PATHS = [
  '/vercel/sandbox/probe.txt',
  '/root/probe.txt',
  '/workspace/probe.txt',
  '/opt/atlas/probe.txt',
]
const TIMEOUT = 240_000

const creds = {
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
}
if (!creds.token || !creds.teamId || !creds.projectId) {
  console.error('PROBE-FAIL missing VERCEL_TOKEN/TEAM_ID/PROJECT_ID env')
  process.exit(1)
}

const log = (msg) => console.log(`PROBE ${new Date().toISOString()} ${msg}`)

const writeMarkers = async (sandbox, marker) => {
  for (const path of PATHS) {
    await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `mkdir -p $(dirname ${path}) && echo ${marker} > ${path}`],
      timeoutMs: 30_000,
    })
  }
}

const readMarkers = async (sandbox) => {
  const found = {}
  for (const path of PATHS) {
    const cmd = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `cat ${path} 2>/dev/null || echo MISSING`],
      timeoutMs: TIMEOUT,
    })
    found[path] = (await cmd.stdout()).trim()
  }
  return found
}

const report = (label, found, marker) => {
  const survived = PATHS.filter((p) => found[p] === marker)
  for (const path of PATHS) log(`  ${label} ${path} -> ${JSON.stringify(found[path])}`)
  log(
    survived.length === PATHS.length
      ? `${label}: ALL PERSISTED`
      : `${label}: survived ${survived.length}/${PATHS.length} [${survived.join(', ')}]`,
  )
  return survived
}

const stopAndResume = async (sandbox) => {
  await sandbox.stop({ signal: AbortSignal.timeout(TIMEOUT) })
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const page = await Snapshot.list({ ...creds, name: NAME })
    const snapshots = await page.toArray()
    if (snapshots.length > 0) break
    log(`no snapshot yet (attempt ${attempt}), waiting 10s`)
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  return Sandbox.get({ ...creds, name: NAME, signal: AbortSignal.timeout(60_000) })
}

let phase = 'create'
try {
  const markerA = `A-${RUN}`
  log(`phase A: create ${NAME}, write, stop, resume`)
  const sandbox = await Sandbox.create({
    ...creds,
    name: NAME,
    region: 'iad1',
    timeout: 5 * 60_000,
    persistent: true,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  await writeMarkers(sandbox, markerA)
  const resumedA = await stopAndResume(sandbox)
  report('A', await readMarkers(resumedA), markerA)

  phase = 'second-cycle'
  log('phase B: second stop/resume cycle on the same sandbox')
  const resumedB = await stopAndResume(resumedA)
  report('B', await readMarkers(resumedB), markerA)

  phase = 'delete-recreate'
  log('phase C: delete the sandbox, recreate under the SAME name, write, stop, resume')
  await resumedB.delete({ signal: AbortSignal.timeout(60_000) })
  const recreated = await Sandbox.create({
    ...creds,
    name: NAME,
    region: 'iad1',
    timeout: 5 * 60_000,
    persistent: true,
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const foundAfterRecreate = await readMarkers(recreated)
  log(`  post-recreate leftovers: ${JSON.stringify(foundAfterRecreate)}`)
  const markerC = `C-${RUN}`
  await writeMarkers(recreated, markerC)
  const resumedC = await stopAndResume(recreated)
  report('C', await readMarkers(resumedC), markerC)

  phase = 'cleanup'
  await resumedC.delete({ signal: AbortSignal.timeout(60_000) })
  log('RESULT: probe complete, sandbox deleted')
} catch (error) {
  log(`RESULT: ERROR in ${phase} — ${error?.message ?? error}`)
  try {
    const doomed = await Sandbox.get({ ...creds, name: NAME, signal: AbortSignal.timeout(30_000) })
    await doomed.delete({ signal: AbortSignal.timeout(60_000) })
    log('cleanup deleted the probe sandbox')
  } catch {
    log('cleanup found nothing to delete')
  }
}
