import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EDefinitionOrigin, toThreadId } from '@dltech/atlas-core'
import type { AgentType } from '@dltech/atlas-harness'

import {
  EWorkspaceState,
  startServe,
  type ServeApp,
  type ServeHandle,
  type WorkspaceFiles,
} from '../index'
import {
  composeOwnershipApp,
  type OwnershipRegistries,
} from './serve-execution-ownership-compose'
import type { OwnershipStep } from './serve-execution-ownership-model'

export const OWNERSHIP_TOKEN = 'ownership-token'
export const OWNERSHIP_THREAD = toThreadId('thread-ownership')

export const OWNERSHIP_AGENT_TYPE: AgentType = {
  name: 'ownership-worker',
  whenToUse: 'owned-work tests only',
  prompt: 'You are the ownership-worker test sub-agent.',
  origin: EDefinitionOrigin.BuiltIn,
}

export type ServeOwnershipWorld = {
  handle: ServeHandle
  app: ServeApp
  home: string
  cwd: string
  shells: OwnershipRegistries['shells']
  agents: OwnershipRegistries['agents']
  services: OwnershipRegistries['services']
}

const emptyContextFiles = (): WorkspaceFiles => ({
  exists: async () => false,
  read: async (path) => {
    throw new Error(`no such file: ${path}`)
  },
  write: async () => undefined,
  writeBytes: async () => undefined,
  ensureDirectory: async () => undefined,
  empty: async () => undefined,
})

const noNetwork: typeof fetch = Object.assign(
  async (): Promise<Response> => new Response(null, { status: 204 }),
  { preconnect: () => undefined },
)

export async function startOwnershipServe(args: {
  main: readonly OwnershipStep[]
  child: readonly OwnershipStep[]
  childGate?: Promise<void> | undefined
  idleMinutes?: number | undefined
  idleTickMs?: number | undefined
  exit?: ((code: number) => void) | undefined
}): Promise<ServeOwnershipWorld> {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-ownership-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'atlas-serve-ownership-cwd-'))
  const heldHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  {
    mkdirSync(join(home, 'bootstrap'), { recursive: true })
    writeFileSync(
      join(home, 'bootstrap', 'workspace-spec.json'),
      JSON.stringify({
        remoteUrl: null,
        branch: null,
        commit: null,
        patch: '',
        githubToken: null,
        contextBundle: null,
      }),
    )

    const composed = await composeOwnershipApp({
      home,
      cwd,
      main: args.main,
      child: args.child,
      childGate: args.childGate,
    })
    const handle = await startServe({
      threadId: OWNERSHIP_THREAD,
      port: 0,
      token: OWNERSHIP_TOKEN,
      controlPlaneUrl: 'https://api.example.com',
      env: {},
      cwd,
      idleMinutes: args.idleMinutes,
      idleTickMs: args.idleTickMs,
      exit: args.exit,
      compose: async () => composed.serveApp,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      contextFiles: emptyContextFiles(),
      fetchFn: noNetwork,
    })

    return {
      handle: {
        port: handle.port,
        close: async (shutdown) => {
          try { await handle.close(shutdown) } finally {
            if (heldHome === undefined) delete process.env.ATLAS_HOME
            else process.env.ATLAS_HOME = heldHome
          }
        },
      },
      app: composed.serveApp,
      home,
      cwd,
      shells: composed.registries.shells,
      agents: composed.registries.agents,
      services: composed.registries.services,
    }
  }
}
