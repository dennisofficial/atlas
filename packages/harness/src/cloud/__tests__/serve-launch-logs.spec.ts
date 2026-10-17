import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Sandbox } from '@vercel/sandbox'

import {
  createServeLauncher,
  SANDBOX_WORKSPACE_PATH,
  SERVE_LOG_PATH,
  SERVE_VERSION_PATH,
} from '@dltech/atlas-wire'
import { tailServeLog } from '../vercel-driver-probes'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-serve-logs-'))
  directories.push(directory)
  const mounted = join(directory, 'home', 'operational')
  const log = join(mounted, 'atlas-serve.log')
  const workspace = join(directory, 'workspace')
  const mapScript = (script: string): string =>
    script
      .replaceAll(SERVE_LOG_PATH, log)
      .replaceAll('/opt/atlas/home/operational', mounted)
      .replaceAll(SANDBOX_WORKSPACE_PATH, workspace)
  const execute = async (script: string) => {
    const process = Bun.spawn(['sh', '-c', mapScript(script)], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ])
    return { stdout, stderr, exitCode }
  }
  return { directory, mounted, log, workspace, execute }
}

describe('serve diagnostic log filesystem behavior', () => {
  it('creates a private mounted log without changing the runtime umask or truncating old boots', async () => {
    const held = await fixture()
    let launch = ''
    const sandbox = {
      name: 'diagnostic-log-probe',
      runCommand: async (args: { args?: string[]; detached?: boolean }) => {
        const script = args.args?.[1] ?? ''
        if (args.detached) {
          launch = script
          return { exitCode: 0 }
        }
        if (script.startsWith('test -x')) return { exitCode: 1 }
        if (script.includes(SERVE_VERSION_PATH)) {
          return { exitCode: 0, stdout: async () => '\n' }
        }
        return { exitCode: script.startsWith('for i in') ? 0 : 1 }
      },
    } as unknown as Sandbox
    await createServeLauncher()({ sandbox })
    const prepare = launch.split('&& exec flock')[0]
    expect(prepare).toBeDefined()
    const workspaceFile = join(held.directory, 'workspace-file')
    const first = await held.execute(`umask 022; ${prepare} && pwd; : > '${workspaceFile}'`)
    expect(first.exitCode).toBe(0)
    expect(first.stdout.trim().endsWith('/workspace')).toBe(true)
    expect((await stat(held.workspace)).isDirectory()).toBe(true)
    expect((await stat(held.log)).mode & 0o777).toBe(0o600)
    expect((await stat(held.mounted)).mode & 0o777).toBe(0o700)
    expect((await stat(workspaceFile)).mode & 0o777).toBe(0o644)
    await writeFile(held.log, 'earlier boot\n')
    const second = await held.execute(`umask 022; ${prepare}`)
    expect(second.exitCode).toBe(0)
    expect(await readFile(held.log, 'utf8')).toBe('earlier boot\n')
  })

  it('tails the serve log from the sandbox home, with a marker when it is missing', async () => {
    const held = await fixture()
    const sandbox = {
      runCommand: async (args: { args: string[] }) => {
        const result = await held.execute(args.args[1] ?? '')
        return { exitCode: result.exitCode, stdout: async () => result.stdout }
      },
    } as unknown as Sandbox
    expect(await tailServeLog(sandbox)).toBe('NO-SERVE-LOG')
    await mkdir(held.mounted, { recursive: true })
    await writeFile(held.log, 'mounted runtime\n')
    expect(await tailServeLog(sandbox)).toBe('mounted runtime')
  })
})
