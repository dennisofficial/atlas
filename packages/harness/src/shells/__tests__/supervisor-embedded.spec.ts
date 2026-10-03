import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SHELL_SUPERVISE_FLAG } from '../supervisor-launch'

const STUB_SUPERVISOR = 'console.log("stub-supervisor", process.argv.slice(2).join(","))\n'

const PATHS_STUB = `export const ATLAS_BIN_DIRECTORY_NAME = 'bin'
export const isEmbeddedBuild = (): boolean => true
`
const BUNDLE_STUB = `export const bundleSupervisorSource = async (): Promise<string> => {
  throw new Error('a compiled binary must not bundle')
}
`
const ENTRY = `import { prepareSupervisorLauncher } from './shells/supervisor-launch'

const launcher = await prepareSupervisorLauncher({ home: process.argv[2] ?? '', embedded: true })
console.log(JSON.stringify(launcher))
`

describe('a compiled binary carrying the supervisor script', () => {
  let workspace: string
  let binary: string

  beforeAll(async () => {
    workspace = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'atlas-embedded-supervisor-'))
    await mkdir(join(workspace, 'src', 'shells'), { recursive: true })
    await mkdir(join(workspace, 'src', 'store'), { recursive: true })
    await mkdir(join(workspace, 'bin'), { recursive: true })

    await copyFile(join(import.meta.dir, '..', 'supervisor-launch.ts'), join(workspace, 'src', 'shells', 'supervisor-launch.ts'))
    await writeFile(join(workspace, 'src', 'shells', 'supervisor-bundle.ts'), BUNDLE_STUB)
    await writeFile(join(workspace, 'src', 'store', 'paths.ts'), PATHS_STUB)
    await writeFile(join(workspace, 'src', 'main.ts'), ENTRY)
    await writeFile(join(workspace, 'bin', 'atlas-supervisor.js'), STUB_SUPERVISOR)

    binary = join(workspace, 'out', 'probe')
    const built = await Bun.build({
      entrypoints: [join(workspace, 'src', 'main.ts')],
      target: 'bun',
      compile: { outfile: binary },
    })
    expect(built.success).toBe(true)

    await rm(join(workspace, 'bin'), { recursive: true, force: true })
    await rm(join(workspace, 'src'), { recursive: true, force: true })
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('materializes the exact script from its own bytes with the source and generated file gone, and no PATH', async () => {
    const home = join(workspace, 'home')
    const ran = Bun.spawnSync({ cmd: [binary, home], cwd: '/', env: {} })

    expect(ran.stderr.toString()).toBe('')
    expect(ran.exitCode).toBe(0)

    const launcher: { script: string; host: string[]; docker: string[] } = JSON.parse(ran.stdout.toString())
    expect(await readFile(launcher.script, 'utf8')).toBe(STUB_SUPERVISOR)
    expect(launcher.script.startsWith(join(home, 'bin'))).toBe(true)
    expect(launcher.host).toEqual([await realpath(binary), SHELL_SUPERVISE_FLAG])
    expect(launcher.docker).toEqual(['bun', launcher.script])
    expect(await readdir(join(workspace))).not.toContain('bin')
  })
})
