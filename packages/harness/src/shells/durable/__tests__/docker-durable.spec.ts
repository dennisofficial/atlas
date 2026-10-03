import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { EKilledBy, toThreadId } from '@dltech/atlas-core'
import { HookChain } from '../../../hooks/registry'
import { RandomIds } from '../../../store/ids'
import { SystemClock } from '../../../store/clock'
import { BunShellRegistry } from '../../shell-registry'
import { ShellLauncherPort } from '../../port'
import { attachmentOf } from '../../durable-attachment'
import { shellFiles } from '../../storage'
import { toShellId } from '../../shell-id'
import { RecordingLog } from '../../__tests__/shell-registry-log'

import { bundleSupervisorSource } from '../../supervisor-bundle'
import { attachDurableShell, EExitCause, ELeaseMode, type ControlTransport } from '../client'
import { collect, readUntil } from './fixture'

const describeDocker = process.env.ATLAS_LIVE_DOCKER === '1' ? describe : describe.skip
const image = 'oven/bun:1'
const container = `atlas-durable-probe-${crypto.randomUUID()}`
let root = ''
let created = false

async function execute(args: { command: readonly string[]; allowFailure?: boolean }) {
  const child = Bun.spawn([...args.command], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0 && !args.allowFailure)
    throw new Error(JSON.stringify({ command: args.command, code, stdout, stderr }))
  return { stdout, stderr, code }
}

function transport({ shellDir }: { shellDir: string }): ControlTransport {
  return async ({ request }) => {
    const result = await execute({
      command: ['docker', 'exec', container, 'bun', join(root, 'supervisor.js'), '--control', shellDir, JSON.stringify(request)],
    })
    return JSON.parse(result.stdout.trim())
  }
}

const launcherSource = `
import { launchDurableShell, ELeaseMode } from ${JSON.stringify(resolve(import.meta.dir, '../client.ts'))};
const [container, root, shellDir, command, limit] = process.argv.slice(1);
const run = async (cmd) => {
  const child = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(JSON.stringify({ cmd, out, err, code }));
  return out;
};
const result = await launchDurableShell({
  shellDir, command, cwd: root, outputLimitBytes: Number(limit),
  env: { ATLAS_HOME: root + '/home' },
  ttlMs: 30000, leaseMs: 300, tickMs: 50, pollMs: 20, killGraceMs: 100,
  leaseMode: ELeaseMode.File,
  supervisorCommand: ['bun', root + '/supervisor.js'],
  launch: async ({ cmd, cwd }) => { await run(['docker', 'exec', '--detach', '--workdir', cwd, container, ...cmd]); },
  transport: async ({ request }) => JSON.parse(await run(['docker', 'exec', container, 'bun', root + '/supervisor.js', '--control', shellDir, JSON.stringify(request)])),
});
if (!result.ok) throw new Error(JSON.stringify(result));
await result.handle.detach();
console.log(JSON.stringify({ launcherPid: process.pid, childPid: result.handle.pid }));
process.exit(0);
`

async function launch(args: { name: string; command: string; limit?: number }) {
  const shellDir = join(root, args.name)
  const result = await execute({
    command: [process.execPath, '-e', launcherSource, container, root, shellDir, args.command, String(args.limit ?? 65536)],
  })
  const launched: { launcherPid: number; childPid: number } = JSON.parse(result.stdout.trim())
  expect(() => process.kill(launched.launcherPid, 0)).toThrow()
  return { shellDir, ...launched }
}

async function attach(args: { shellDir: string; cursor?: number }) {
  const result = await attachDurableShell({
    ...args,
    transport: transport(args),
    leaseMode: ELeaseMode.File,
    pollMs: 20,
  })
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result.handle
}

async function descriptors(args: { childPid: number }) {
  const result = await execute({
    command: [
      'docker', 'exec', container, 'bun', '-e',
      `console.log(JSON.stringify([1,2].map(fd=>require('node:fs').readlinkSync('/proc/${args.childPid}/fd/'+fd))))`,
    ],
  })
  return JSON.parse(result.stdout.trim())
}

describeDocker('real Docker durable supervisor', () => {
  beforeAll(async () => {
    await execute({ command: ['docker', 'info', '--format', '{{.ServerVersion}}'] })
    const available = await execute({ command: ['docker', 'image', 'inspect', image], allowFailure: true })
    if (available.code !== 0) await execute({ command: ['docker', 'pull', image] })
    root = await mkdtemp('/tmp/atlas-durable-docker-')
    await mkdir(join(root, 'home'))
    await writeFile(join(root, 'mount-marker'), container)
    await writeFile(join(root, 'supervisor.js'), await bundleSupervisorSource())
    await execute({
      command: [
        'docker', 'run', '-d', '--name', container,
        '--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        '--mount', `type=bind,src=${root},dst=${root}`,
        '--env', `ATLAS_HOME=${join(root, 'home')}`,
        '--entrypoint', 'bun', image, '-e',
        'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 60000)',
      ],
    })
    created = true
    const mounted = await execute({ command: ['docker', 'exec', container, 'cat', join(root, 'mount-marker')] })
    expect(mounted.stdout).toBe(container)
  }, 180000)

  afterAll(async () => {
    if (created) {
      const inspected = await execute({ command: ['docker', 'inspect', '--format', '{{.Name}}', container] })
      expect(inspected.stdout.trim()).toBe(`/${container}`)
      await execute({ command: ['docker', 'kill', container] })
      await execute({ command: ['docker', 'rm', container] })
      const absent = await execute({ command: ['docker', 'inspect', container], allowFailure: true })
      expect(absent.code).not.toBe(0)
    }
    if (root) {
      const target = await lstat(root)
      expect(target.isDirectory() && !target.isSymbolicLink()).toBe(true)
      expect(await readFile(join(root, 'mount-marker'), 'utf8')).toBe(container)
      await rm(root, { recursive: true })
    }
  }, 30000)

  test('survives its launcher, resumes input and spool cursor after detach, and records exact exit', async () => {
    const launched = await launch({
      name: 'interactive',
      command: 'echo ready; read first; echo "first:$first"; read second; echo "second:$second"; exit 7',
    })
    const control = transport(launched)
    expect(await control({ request: { type: 'probe' } })).toEqual({
      ok: true,
      probe: { supervisorAlive: true, childAlive: true, reachable: true },
    })
    expect(await descriptors(launched)).toEqual([
      join(launched.shellDir, 'spool.out'), join(launched.shellDir, 'spool.out'),
    ])
    const first = await attach(launched)
    const ready = await readUntil({ stream: first.stdout, pattern: 'ready\n' })
    expect(ready.text).toBe('ready\n')
    expect(await first.writeInput('hello\n')).toEqual({ ok: true })
    expect(new TextDecoder().decode((await ready.reader.read()).value)).toBe('first:hello\n')
    const cursor = first.spoolOffset()
    const leases = (await readdir(join(launched.shellDir, 'leases'))).filter(name => name.endsWith('.lease'))
    expect(leases).toHaveLength(1)
    await first.detach()
    expect(await first.settled).toEqual({ kind: 'detached' })
    expect((await readdir(join(launched.shellDir, 'leases'))).filter(name => name.endsWith('.lease'))).toEqual([])
    const second = await attach({ shellDir: launched.shellDir, cursor })
    expect(await second.writeInput('world\n')).toEqual({ ok: true })
    expect(await collect({ stream: second.stdout })).toBe('second:world\n')
    expect(await second.exited).toBe(7)
    const settled = await second.settled
    expect(settled.kind === 'exited' && settled.exit.cause).toBe(EExitCause.Natural)
    const replay = await attach(launched)
    expect(await collect({ stream: replay.stdout })).toBe('ready\nfirst:hello\nsecond:world\n')
    expect(await replay.exited).toBe(7)
    const ended = await control({ request: { type: 'probe' } })
    expect(ended.ok && ended.probe?.childAlive).toBe(false)
  }, 30000)

  test('kernel file-size cap stops a direct spool writer with exact SIGXFSZ exit', async () => {
    const launched = await launch({ name: 'cap', command: 'echo cap-ready; read go; exec yes', limit: 2048 })
    const handle = await attach(launched)
    expect((await readUntil({ stream: handle.stdout, pattern: 'cap-ready\n' })).text).toBe('cap-ready\n')
    expect(await descriptors(launched)).toEqual([
      join(launched.shellDir, 'spool.out'), join(launched.shellDir, 'spool.out'),
    ])
    expect(await handle.writeInput('go\n')).toEqual({ ok: true })
    expect(await handle.exited).toBe(153)
    const settled = await handle.settled
    expect(settled.kind).toBe('exited')
    if (settled.kind !== 'exited') throw new Error(JSON.stringify(settled))
    expect(settled.exit).toMatchObject({
      code: null, signal: 'SIGXFSZ', exitCode: 153, cause: 'output-limit', spoolBytes: 2048, limitBytes: 2048,
      overflowEvidence: ['spool-at-limit', 'leader-killed-by-sigxfsz'],
    })
    const replay = await attach(launched)
    expect(Buffer.byteLength(await collect({ stream: replay.stdout }))).toBe(2048)
    expect((await stat(join(launched.shellDir, 'spool.out'))).size).toBe(2048)
  }, 30000)

  test('records the owner’s real ending and output before its container is removed', async () => {
    const threadId = toThreadId('docker-journal-owner')
    const shellId = toShellId('shell_docker_journal')
    const files = shellFiles({ sessionDir: root, threadId, shellId })
    class Launcher extends ShellLauncherPort {
      async launch() {
        const launched = await launch({
          name: `threads/${threadId}/shells/${shellId}`,
          command: 'echo kept-through-teardown; sleep 300',
        })
        const handle = await attach(launched)
        return { ok: true as const, attachment: attachmentOf({ handle, files, shellId, startedAt: new Date().toISOString() }) }
      }
      async inspect() { return [] }
    }
    const log = new RecordingLog()
    const registry = new BunShellRegistry({
      root,
      clock: new SystemClock(),
      hooks: () => new HookChain({}),
      launcher: new Launcher(),
      log,
      ids: new RandomIds(),
    })
    const started = await registry.start({ threadId, command: 'echo kept-through-teardown; sleep 300', description: 'verify Docker teardown' })
    if (!started.ok) throw new Error(started.reason)
    await registry.closeAll()
    const ending = log.appended.find((draft) => draft.type === 'background-shell-ended')
    expect(ending?.type).toBe('background-shell-ended')
    if (ending?.type !== 'background-shell-ended') throw new Error('the owner needs a durable ending')
    expect(ending.output).toContain('kept-through-teardown')
    expect(ending.killedBy).toBe(EKilledBy.SessionEnd)
    expect(await readFile(files.output, 'utf8')).toContain('kept-through-teardown')
    expect(registry.drainNotifications({ threadId })).toEqual([])
  }, 30000)

  test('replays stdout and stderr with exact exit after an unattended command finishes', async () => {
    const launched = await launch({ name: 'ended', command: 'echo one; echo two >&2; exit 3' })
    const handle = await attach(launched)
    expect(await collect({ stream: handle.stdout })).toBe('one\ntwo\n')
    expect(await handle.exited).toBe(3)
    expect(await collect({ stream: handle.stderr })).toBe('')
  }, 30000)
})
