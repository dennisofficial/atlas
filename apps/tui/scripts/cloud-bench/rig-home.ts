import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { ATLAS_ALLOW_REAL_HOME_ENV, ATLAS_DIRECTORY_NAME, ATLAS_HOME_ENV } from '@dltech/atlas-core'
import {
  CloudSessionStore,
  FileSecretsStore,
  SecretCipher,
  atlasCloudFile,
  atlasSecretsFile,
  atlasVaultKeyFile,
  loadSettings,
  requireVercelCredentials,
  runGit,
  type SettingsBinding,
} from '@dltech/atlas-harness'
import type { VercelCredentials } from '@dltech/atlas-wire'

export type RigEnv = {
  home: string
  workspace: string
  settings: SettingsBinding
  secrets: FileSecretsStore
  credentials: VercelCredentials
  cloudUrl: string
  cleanup: () => Promise<void>
}

const REAL_HOME_FILES = ['cloud.json', 'key', 'secrets.json', 'settings.json', 'auth.json'] as const

const restoreEnv = (args: { name: string; value: string | undefined }): void => {
  if (args.value === undefined) delete process.env[args.name]
  else process.env[args.name] = args.value
}

const seedFromRealHome = async (home: string): Promise<void> => {
  const previousHatch = process.env[ATLAS_ALLOW_REAL_HOME_ENV]
  process.env[ATLAS_ALLOW_REAL_HOME_ENV] = '1'
  try {
    const real = join(homedir(), ATLAS_DIRECTORY_NAME)
    for (const name of REAL_HOME_FILES) {
      await copyFile(join(real, name), join(home, name)).catch(() => undefined)
    }
  } finally {
    restoreEnv({ name: ATLAS_ALLOW_REAL_HOME_ENV, value: previousHatch })
  }
}

export const NO_REMOTE_REPO = 'none'

const initRemoteless = async (workspace: string): Promise<void> => {
  const steps: readonly (readonly string[])[] = [
    ['init', '--initial-branch=main'],
    [
      '-c',
      'user.name=Atlas Rig',
      '-c',
      'user.email=rig@atlas.dev',
      'commit',
      '--allow-empty',
      '-m',
      'rig base',
    ],
  ]
  for (const step of steps) {
    const run = await runGit({ args: step, cwd: workspace })
    if (!run.ok) throw new Error(`git ${step.join(' ')} failed: ${run.stderr.trim()}`)
  }
}

const cloneInto = async (args: { repo: string; workspace: string }): Promise<void> => {
  if (args.repo === NO_REMOTE_REPO) return initRemoteless(args.workspace)
  const cloned = await runGit({
    args: ['clone', '--depth', '1', args.repo, args.workspace],
    cwd: tmpdir(),
  })
  if (!cloned.ok) throw new Error(`git clone of ${args.repo} failed: ${cloned.stderr.trim()}`)
}

export async function prepareRigEnv(args: { repo: string }): Promise<RigEnv> {
  const previousHome = process.env[ATLAS_HOME_ENV]
  const home = await mkdtemp(join(tmpdir(), 'atlas-rig-home-'))
  let workspace: string | null = null
  let settings: SettingsBinding | null = null
  let cleaning: Promise<void> | null = null

  const cleanup = (): Promise<void> => {
    cleaning ??= (async () => {
      try {
        settings?.service.close()
      } finally {
        restoreEnv({ name: ATLAS_HOME_ENV, value: previousHome })
        await rm(home, { recursive: true, force: true })
        if (workspace !== null) await rm(workspace, { recursive: true, force: true })
      }
    })()
    return cleaning
  }

  try {
    await seedFromRealHome(home)
    process.env[ATLAS_HOME_ENV] = home

    const cloneTarget = await mkdtemp(join(tmpdir(), 'atlas-rig-workspace-'))
    workspace = cloneTarget
    await cloneInto({ repo: args.repo, workspace: cloneTarget })

    const loaded = loadSettings({ env: process.env, cwd: cloneTarget })
    settings = loaded
    const secrets = new FileSecretsStore({
      file: atlasSecretsFile(),
      cipher: new SecretCipher(atlasVaultKeyFile()),
    })
    const credentials = requireVercelCredentials({ settings: loaded.service, secrets })
    const cloudUrl =
      new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() }).read()?.url ??
      ''

    return {
      home,
      workspace: cloneTarget,
      settings: loaded,
      secrets,
      credentials,
      cloudUrl,
      cleanup,
    }
  } catch (error) {
    await cleanup().catch(() => undefined)
    throw error
  }
}
