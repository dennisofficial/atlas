import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ProcessPort, type SpawnCommand } from '@dltech/atlas-core'

import { BashTool } from '../bash'
import { ForegroundOnlyShells } from '../../runtime/foreground-shells'
import { files, processes, useTempAtlasHome } from './support'

useTempAtlasHome()

const SECRETS = ['DATABASE_URL', 'REDIS_URL', 'DAEMON_SECRET', 'SECRETS_ENCRYPTION_KEY']
const previous = { ...process.env }

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-bash-env-'))
})

beforeEach(() => {
  for (const name of SECRETS) process.env[name] = `host-secret-${name}`
})

afterEach(() => {
  for (const name of SECRETS) {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  }
})

const spawnedEnvOf = async (shellEnv?: () => Record<string, string>) => {
  const spawned: SpawnCommand[] = []
  const recording: ProcessPort = {
    spawn: (args) => {
      spawned.push(args)
      return processes.spawn(args)
    },
    which: (args) => processes.which(args),
  } as ProcessPort
  const tool = new BashTool(new ForegroundOnlyShells(), files, recording, shellEnv)
  await tool.invoke({
    input: { description: 'Print a word', command: 'echo hi' },
    signal: new AbortController().signal,
    idempotencyKey: 'bash-env',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })
  return spawned[0]?.env
}

describe('the env a shell is spawned with', () => {
  it('is exactly what the shell env source names, never the host process env', async () => {
    const env = await spawnedEnvOf(() => ({ GH_TOKEN: 'gho_abc' }))
    expect(env).toEqual({ GH_TOKEN: 'gho_abc' })
  })

  it('is empty without a source', async () => {
    expect(await spawnedEnvOf()).toEqual({})
  })
})
