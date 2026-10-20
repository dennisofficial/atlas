import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeSupervisorBundle } from '../supervisor-bundle'
import { SHELL_SUPERVISE_FLAG, prepareSupervisorLauncher, supervisorCommand } from '../supervisor-launch'

const SCRIPT = 'console.log("supervised", process.argv.slice(2).join(","))\n'

describe('prepareSupervisorLauncher', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'atlas-supervisor-launch-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('materializes the script under the home bin directory, content-addressed and idempotent', async () => {
    const first = await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded: false })
    const second = await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded: false })

    expect(first.script).toBe(second.script)
    expect(first.script.startsWith(join(home, 'bin') + '/')).toBe(true)
    expect(await readFile(first.script, 'utf8')).toBe(SCRIPT)
    expect(await readdir(join(home, 'bin'))).toEqual([first.script.split('/').at(-1) ?? ''])
  })

  it('writes a new file when the script changes instead of overwriting one a supervisor may be running', async () => {
    const one = await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded: false })
    const two = await prepareSupervisorLauncher({ home, source: async () => `${SCRIPT}//v2\n`, embedded: false })

    expect(two.script).not.toBe(one.script)
    expect(await readFile(one.script, 'utf8')).toBe(SCRIPT)
  })

  it('launches a source checkout host-side with the running Bun and the script', async () => {
    const launcher = await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded: false })

    expect(launcher.host).toEqual([process.execPath, launcher.script])
  })

  it('launches a compiled binary host-side by re-executing itself, needing no Bun on the host', async () => {
    const launcher = await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded: true })

    expect(launcher.host).toEqual([process.execPath, SHELL_SUPERVISE_FLAG])
  })

  it('always launches Docker with the sandbox Bun and the shared script path', async () => {
    for (const embedded of [true, false]) {
      const launcher = await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded })

      expect(launcher.docker).toEqual(['bun', launcher.script])
    }
  })

  it('appends the config path to the prefix for the chosen runtime', async () => {
    const launcher = await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded: true })

    expect(supervisorCommand({ launcher, docker: false, configPath: '/c.json' })).toEqual([
      process.execPath,
      SHELL_SUPERVISE_FLAG,
      '/c.json',
    ])
    expect(supervisorCommand({ launcher, docker: true, configPath: '/c.json' })).toEqual([
      'bun',
      launcher.script,
      '/c.json',
    ])
  })
})

describe('prepareSupervisorLauncher against a tampered bin directory', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'atlas-supervisor-tamper-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const pathOf = async (): Promise<string> =>
    (await prepareSupervisorLauncher({ home, source: async () => SCRIPT, embedded: false })).script

  it('creates the bin directory 0700 and the script 0600', async () => {
    const script = await pathOf()

    expect((await stat(join(home, 'bin'))).mode & 0o777).toBe(0o700)
    expect((await stat(script)).mode & 0o777).toBe(0o600)
  })

  it('replaces a script whose content was altered', async () => {
    const script = await pathOf()
    await writeFile(script, 'process.exit(99)\n')

    expect(await pathOf()).toBe(script)
    expect(await readFile(script, 'utf8')).toBe(SCRIPT)
  })

  it('replaces a group-writable script even when its content matches', async () => {
    const script = await pathOf()
    await chmod(script, 0o666)

    await pathOf()

    expect((await stat(script)).mode & 0o777).toBe(0o600)
  })

  it('replaces a symlink at the script path without writing through it', async () => {
    const script = await pathOf()
    const target = join(home, 'elsewhere.js')
    await writeFile(target, SCRIPT)
    await rm(script)
    await symlink(target, script)

    await pathOf()

    expect((await lstat(script)).isSymbolicLink()).toBe(false)
    expect(await readFile(script, 'utf8')).toBe(SCRIPT)
    expect(await readFile(target, 'utf8')).toBe(SCRIPT)
  })

  it('leaves no staging files behind', async () => {
    await pathOf()

    expect((await readdir(join(home, 'bin'))).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('supervisor bundle', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'atlas-supervisor-bundle-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('bundles an entry with its dependencies inlined so it runs with no node_modules', async () => {
    const entry = join(import.meta.dir, 'supervisor-bundle-entry.ts')
    const outfile = await writeSupervisorBundle({ entry, outfile: join(directory, 'out', 'sup.js') })

    expect(await readFile(outfile, 'utf8')).not.toContain('from "zod"')
    const ran = Bun.spawnSync({ cmd: [process.execPath, outfile, 'a', 'b'], cwd: '/' })

    expect(ran.stderr.toString()).toBe('')
    expect(ran.stdout.toString().trim()).toBe('ok:a,b')
  })
})
