import { afterAll, beforeAll, expect, it } from 'bun:test'

import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CHANNEL_PROTOCOL_VERSION } from '../../../cloud/channel-wire'
import {
  createServeLauncher,
  installServe,
  type ServeInstaller,
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOG_PATH,
  SERVE_PROTOCOL_PATH,
  SERVE_VERSION_PATH,
} from '@dltech/atlas-wire'
import { DockerEngine } from '../engine'
import { DEFAULT_DOCKER_SOCKET, DEFAULT_SANDBOX_IMAGE, ensureSandbox } from '../sandbox'
import { runSandboxScript } from '../sandbox-scripts'
import { removeTestSandboxes, uniqueTestPrefix } from './docker-test-cleanup'
import {
  buildServeBinary,
  dockerSandbox,
  OLD_SERVE_STUB,
  serveRelease,
  type DownloadSource,
} from './serve-hot-swap-fixtures'
import { describeLiveDocker, quoted } from './live-docker'

const SOCKET = DEFAULT_DOCKER_SOCKET
const PREFIX = uniqueTestPrefix('serve-hot-swap')
const engine = new DockerEngine({ socketPath: SOCKET })

const OPERATOR_HOME = '/home/atlas-hot-swap'
const SERVE_PORT = '4999'
const SERVE_TOKEN = 'hot-swap-token'
const OLD_VERSION = '0.0.1'
const NEW_VERSION = '9.9.9'
const SENTINEL_PATH = `${OPERATOR_HOME}/hot-swap-sentinel`
const SENTINEL = `operator state ${randomUUID()}`
const TMP_PATH = '/tmp/hot-swap-tmp-file'
const TMP_CONTENT = `scratch state ${randomUUID()}`
const describeDocker = await describeLiveDocker({ socket: SOCKET, what: 'live serve hot-swap' })

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describeDocker('serve hot-swap on a real sandbox container', () => {
  let fixtureRoot = ''
  let server: ReturnType<typeof Bun.serve> | undefined
  let containerId = ''
  let newServeSha = ''
  let newServeBytes = 0
  let gateway = ''
  const source: DownloadSource = { base: '' }
  const installs: string[] = []
  const logs: string[] = []

  const script = async (body: string, user?: string): Promise<string> => {
    const outcome = await runSandboxScript({
      engine,
      containerId,
      cwd: '/',
      script: `set -eu\n${body}`,
      ...(user === undefined ? {} : { user }),
    })
    if (outcome.exitCode !== 0) throw new Error(`sandbox script exited ${outcome.exitCode}\n${outcome.output}`)
    return outcome.output
  }

  const countingInstaller: ServeInstaller = async (installArgs) => {
    installs.push(installArgs.version ?? 'latest')
    await installServe(installArgs)
  }

  const launch = (version: string): Promise<void> =>
    createServeLauncher({ log: (line) => logs.push(line), installServe: countingInstaller })({
      sandbox: dockerSandbox({ engine, containerId, source }),
      token: SERVE_TOKEN,
      desiredVersion: version,
    })

  const stopServe = async (): Promise<void> => {
    await script(
      `_pid=$(cat ${SERVE_HOME}/atlas-serve.pid 2>/dev/null || true)
[ -z "$_pid" ] || kill "$_pid" 2>/dev/null || true
for _ in $(seq 50); do kill -0 "$_pid" 2>/dev/null || exit 0; sleep 0.1; done
exit 1`,
    )
  }

  const plantOldServe = async (): Promise<string> => {
    await stopServe()
    await script(
      `cat > ${SERVE_BINARY_PATH} <<'STUB'
${OLD_SERVE_STUB}STUB
chmod 0755 ${SERVE_BINARY_PATH}
printf '%s' ${OLD_VERSION} > ${SERVE_VERSION_PATH}
printf '%s' ${CHANNEL_PROTOCOL_VERSION} > ${SERVE_PROTOCOL_PATH}`,
    )
    installs.length = 0
    logs.length = 0
    await launch(OLD_VERSION)
    expect(installs).toEqual([])
    expect(await health()).toContain('"stub":"old-serve"')
    installs.length = 0
    logs.length = 0
    return binarySha()
  }

  const serveAlive = async (): Promise<boolean> =>
    (
      await runSandboxScript({
        engine,
        containerId,
        cwd: '/',
        script: `kill -0 $(cat ${SERVE_HOME}/atlas-serve.pid 2>/dev/null) 2>/dev/null`,
      })
    ).exitCode === 0

  const binarySha = (): Promise<string> =>
    script(`sha256sum ${SERVE_BINARY_PATH}`).then((line) => line.split(/\s+/)[0] ?? '')

  const health = (): Promise<string> =>
    script(
      `curl -sf -m 5 -H "Authorization: Bearer ${SERVE_TOKEN}" http://localhost:${SERVE_PORT}/v1/health`,
    )

  const expectOperatorStateIntact = async (): Promise<void> => {
    expect(await script(`cat ${SENTINEL_PATH}`)).toBe(SENTINEL)
    expect(await script(`cat ${TMP_PATH}`)).toBe(TMP_CONTENT)
  }

  const expectContainerSurvived = async (): Promise<void> => {
    const details = await engine.inspectContainer({ id: containerId })
    expect(details.state.running).toBe(true)
  }

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(await realpath(tmpdir()), 'atlas-serve-hot-swap-'))
    const worktree = join(fixtureRoot, 'project')
    await mkdir(worktree)
    await chmod(worktree, 0o777)

    const binaryPath = join(fixtureRoot, 'atlas-serve')
    await buildServeBinary(binaryPath)
    const bytes = new Uint8Array(await readFile(binaryPath))
    newServeSha = sha256Of(bytes)
    newServeBytes = bytes.length

    server = serveRelease({ bytes, sha256: newServeSha })

    const sandbox = await ensureSandbox({
      engine,
      config: {
        image: DEFAULT_SANDBOX_IMAGE,
        worktree,
        session: `serve-hot-swap-${process.pid}`,
        uid: 501,
        gid: 20,
        home: OPERATOR_HOME,
        limits: { cpus: 0, memoryBytes: 0 },
        dockerSocket: SOCKET,
        labelPrefix: PREFIX,
        env: { ATLAS_SERVE_PORT: SERVE_PORT, ATLAS_THREAD_ID: 'hot-swap' },
      },
    })
    containerId = sandbox.id

    gateway = await script(
      `h=$(awk '$2=="00000000"{print $3; exit}' /proc/net/route)
printf '%d.%d.%d.%d' 0x$(echo $h|cut -c7-8) 0x$(echo $h|cut -c5-6) 0x$(echo $h|cut -c3-4) 0x$(echo $h|cut -c1-2)`,
      '0',
    )
    source.base = `http://${gateway}:${server.port}/release`

    await script(
      `install -d -m 0777 ${SERVE_HOME} /atlas/home/operational
printf '%s' ${quoted(SENTINEL)} > ${SENTINEL_PATH}
printf '%s' ${quoted(TMP_CONTENT)} > ${TMP_PATH}
chown 501:20 ${SENTINEL_PATH} ${TMP_PATH} /atlas/home/operational`,
      '0',
    )
  }, 10 * 60_000)

  afterAll(async () => {
    try {
      server?.stop(true)
      await removeTestSandboxes({ engine, prefix: PREFIX })
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  }, 2 * 60_000)

  it('has the host reachable from the container and the operator state planted', async () => {
    expect(gateway).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(await script(`curl -sf -m 10 ${source.base}/atlas-serve-linux-x64.sha256`)).toBe(
      `${newServeSha}  atlas-serve-linux-x64`,
    )
    await expectOperatorStateIntact()
  }, 60_000)

  it('treats the old serve as alive and keeps it when the pin matches', async () => {
    const oldSha = await plantOldServe()
    expect(await serveAlive()).toBe(true)

    await launch(OLD_VERSION)
    expect(logs.join('\n')).toContain('has a live serve answering /v1/health — keeping it')
    expect(installs).toEqual([])
    expect(await binarySha()).toBe(oldSha)
    expect(await health()).toContain('"stub":"old-serve"')
  }, 2 * 60_000)

  it('keeps the old serve running and its binary, stamp, sandbox and operator state intact when the download is dead', async () => {
    const oldSha = await plantOldServe()

    source.base = `http://${gateway}:1/release`
    await expect(launch(NEW_VERSION)).rejects.toThrow(/failed to install into the sandbox/)

    expect(installs).toEqual([NEW_VERSION])
    expect(await binarySha()).toBe(oldSha)
    expect(await script(`cat ${SERVE_VERSION_PATH}`)).toBe(OLD_VERSION)
    expect(await script(`ls ${SERVE_HOME}`)).not.toContain('.next')
    expect(await serveAlive()).toBe(true)
    expect(await health()).toContain('"stub":"old-serve"')
    await expectOperatorStateIntact()
    await expectContainerSurvived()
  }, 2 * 60_000)

  it('keeps the old binary when the downloaded binary fails its sha256', async () => {
    const oldSha = await plantOldServe()

    source.base = `http://${gateway}:${server?.port}/corrupt`
    await expect(launch(NEW_VERSION)).rejects.toThrow(/sha256 mismatch/)

    expect(await binarySha()).toBe(oldSha)
    expect(await script(`cat ${SERVE_VERSION_PATH}`)).toBe(OLD_VERSION)
    expect(await script(`ls ${SERVE_HOME}`)).not.toContain('.next')
    await expectOperatorStateIntact()
    await expectContainerSurvived()
  }, 2 * 60_000)

  const expectSwapped = async (): Promise<void> => {
    expect(installs).toEqual([NEW_VERSION])
    expect(await binarySha()).toBe(newServeSha)
    expect(Number(await script(`stat -c %s ${SERVE_BINARY_PATH}`))).toBe(newServeBytes)
    expect(await script(`stat -c %a ${SERVE_BINARY_PATH}`)).toBe('755')
    expect(await script(`cat ${SERVE_VERSION_PATH}`)).toBe(NEW_VERSION)
    expect(await script(`cat ${SERVE_PROTOCOL_PATH}`)).toBe(String(CHANNEL_PROTOCOL_VERSION))
    expect(await script(`ls ${SERVE_HOME}`)).not.toContain('.next')

    expect(await serveAlive()).toBe(true)
    const body = JSON.parse(await health()) as {
      threadId: string
      rotationPreparationVersion?: number
      stub?: string
    }
    expect(body.stub).toBeUndefined()
    expect(body.threadId).toBe('hot-swap')
    expect(body.rotationPreparationVersion).toBeGreaterThan(0)
    expect(await script(`tail -c 4096 ${SERVE_LOG_PATH}`)).toContain('serve.listening')

    await expectContainerSurvived()
    await expectOperatorStateIntact()
  }

  it('swaps a live, version-drifted serve in place: stopped, replaced, rebooted healthy, filesystem intact', async () => {
    await plantOldServe()
    source.base = `http://${gateway}:${server?.port}/release`

    const startedAt = performance.now()
    await launch(NEW_VERSION)
    console.info(
      `live-drift hot-swap (stop + download + install + boot + healthy): ${Math.round(performance.now() - startedAt)}ms for ${newServeBytes} bytes`,
    )

    expect(logs.join('\n')).toContain(
      'stale against "9.9.9" — downloading the replacement first so a failed download leaves it serving',
    )
    expect(logs.join('\n')).toContain('needs "9.9.9" — stopping it to swap in place')
    await expectSwapped()
  }, 5 * 60_000)

  it('swaps in when the old serve is already stopped', async () => {
    await plantOldServe()
    await stopServe()
    expect(await serveAlive()).toBe(false)
    source.base = `http://${gateway}:${server?.port}/release`

    await launch(NEW_VERSION)

    expect(logs.join('\n')).toContain(`carries serve "${OLD_VERSION}"`)
    await expectSwapped()
  }, 5 * 60_000)

  it('keeps the swapped serve on the next launch without downloading again', async () => {
    installs.length = 0
    logs.length = 0
    await launch(NEW_VERSION)
    expect(installs).toEqual([])
    expect(logs.join('\n')).toContain('has a live serve answering /v1/health — keeping it')
    expect(await binarySha()).toBe(newServeSha)
  }, 2 * 60_000)
})
