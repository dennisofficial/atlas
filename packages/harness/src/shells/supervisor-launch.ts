import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { ATLAS_BIN_DIRECTORY_NAME, isEmbeddedBuild } from '../store/paths'
import { bundleSupervisorSource } from './supervisor-bundle'

export const SHELL_SUPERVISE_FLAG = '--shell-supervise'

const SCRIPT_PREFIX = 'atlas-supervisor-'
const DOCKER_BUN = 'bun'

export type SupervisorLauncher = {
  readonly script: string
  readonly host: readonly string[]
  readonly docker: readonly string[]
}

export type SupervisorScriptSource = () => Promise<string>

const embeddedSupervisorText: SupervisorScriptSource = async () => {
  const embedded: { default: string } = await import('../../bin/atlas-supervisor.js' as string, {
    with: { type: 'text' },
  })
  return embedded.default
}

let bundled: Promise<string> | undefined

const defaultScriptSource = (embedded: boolean): SupervisorScriptSource => async () => {
  if (embedded) return await embeddedSupervisorText()
  bundled ??= bundleSupervisorSource().catch((error: unknown) => {
    bundled = undefined
    throw error
  })
  return await bundled
}

const hostPrefix = (args: { embedded: boolean; script: string; sourceEntry?: string | undefined }): readonly string[] =>
  args.embedded ? [process.execPath, SHELL_SUPERVISE_FLAG] : [process.execPath, args.sourceEntry ?? args.script]

const BIN_DIRECTORY_MODE = 0o700
const SCRIPT_MODE = 0o600
const GROUP_OR_OTHER_WRITE = 0o022

const holdsExactly = async (args: { path: string; text: string }): Promise<boolean> => {
  const handle = await open(args.path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null)
  if (handle === null) return false

  try {
    const info = await handle.stat()
    const owned = process.getuid === undefined || info.uid === process.getuid()
    if (!info.isFile() || !owned || (info.mode & GROUP_OR_OTHER_WRITE) !== 0) return false
    return (await handle.readFile('utf8')) === args.text
  } finally {
    await handle.close()
  }
}

const writeExclusive = async (args: { path: string; text: string }): Promise<void> => {
  const handle = await open(
    args.path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    SCRIPT_MODE,
  )
  try {
    await handle.writeFile(args.text)
  } finally {
    await handle.close()
  }
}

async function materialize(args: { home: string; text: string }): Promise<string> {
  const bin = join(args.home, ATLAS_BIN_DIRECTORY_NAME)
  await mkdir(bin, { recursive: true, mode: BIN_DIRECTORY_MODE })

  const digest = createHash('sha256').update(args.text).digest('hex').slice(0, 16)
  const script = join(bin, `${SCRIPT_PREFIX}${digest}.js`)
  if (await holdsExactly({ path: script, text: args.text })) return script

  const staging = `${script}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await writeExclusive({ path: staging, text: args.text })
    await rename(staging, script)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
  return script
}

export async function prepareSupervisorLauncher(args: {
  home: string
  source?: SupervisorScriptSource | undefined
  embedded?: boolean | undefined
}): Promise<SupervisorLauncher> {
  const embedded = args.embedded ?? isEmbeddedBuild()
  const text = await (args.source ?? defaultScriptSource(embedded))()
  const script = await materialize({ home: args.home, text })

  const sourceEntry = args.source === undefined ? join(import.meta.dir, 'durable', 'supervisor-main.ts') : undefined
  return { script, host: hostPrefix({ embedded, script, sourceEntry }), docker: [DOCKER_BUN, script] }
}

export const supervisorCommand = (args: {
  launcher: SupervisorLauncher
  docker: boolean
  configPath: string
}): readonly string[] => [...(args.docker ? args.launcher.docker : args.launcher.host), args.configPath]
