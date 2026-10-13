import { homedir } from 'node:os'

import { LogPort } from '@dltech/atlas-core'

import { cloudUserFilesClientFor } from '../cloud/user-files-client'
import { registerDisposable } from '../container/disposal'
import { registeredPortToken, type DependencyContainer } from '../container/injection'
import { CloudSessionStoreToken } from '../container/tokens'
import { resolveProjectMemory } from '../memory/project-memory'
import { atlasDirectory } from '../store/paths'
import { createUserLayerSync } from '../user-layer-sync/factory'
import { NullUserLayerSync, UserLayerSyncPort } from '../user-layer-sync/port'

const warnStart = (log: LogPort) => (error: unknown) => {
  log.warn({
    source: 'user-layer-sync',
    message: `user-layer sync did not start: ${error instanceof Error ? error.message : String(error)}`,
  })
}

/**
 * The user layer (skills/instructions/memory) syncs only while signed in to Atlas Cloud; a
 * signed-out session composes the no-op port so the registry slot is never unbound. The engine
 * is registered at compose but NOT started — composing must never open a socket (the
 * local-first outage contract forbids a signed-in session from touching the cloud when it is
 * down), so `start` is returned for the caller to fire on the first real activity. Serve passes
 * its own home (`driveHome`) via `home`.
 */
export async function bindUserLayerSync(args: {
  container: DependencyContainer
  clientVersion: string
  projectDirectory?: string | undefined
  /** Serve passes the drive home so `.agents`/`.claude` roots resolve under the persistent home. */
  home?: string | undefined
  override?:
    | { home: string; atlasHome: string; client: Parameters<typeof createUserLayerSync>[0]['client'] }
    | undefined
}): Promise<{ start: () => void }> {
  const { container } = args
  const log = container.resolve(registeredPortToken(LogPort))

  const sessions = container.isRegistered(CloudSessionStoreToken, true)
    ? container.resolve(CloudSessionStoreToken)
    : undefined
  const session = sessions?.read() ?? null

  const binding =
    args.override !== undefined
      ? {
          home: args.override.home,
          atlasHome: args.override.atlasHome,
          client: args.override.client,
        }
      : session === null
        ? null
        : {
            home: args.home ?? homedir(),
            atlasHome: atlasDirectory(),
            client: cloudUserFilesClientFor({ session, clientVersion: args.clientVersion }),
          }

  if (binding === null) {
    container.register(registeredPortToken(UserLayerSyncPort), { useValue: new NullUserLayerSync() })
    return { start: () => undefined }
  }

  const projectMemory = await resolveProjectMemory({
    atlasHome: binding.atlasHome,
    repoRoot: args.projectDirectory ?? binding.home,
  })
    .then((resolved) => resolved.directories.project)
    .catch(() => undefined)

  const engine = createUserLayerSync({
    atlasHome: binding.atlasHome,
    home: binding.home,
    projectDirectory: args.projectDirectory,
    projectMemoryDirectory: projectMemory,
    client: binding.client,
    log,
  })
  container.register(registeredPortToken(UserLayerSyncPort), { useValue: engine })
  registerDisposable({
    container,
    close: async () => {
      engine.stop()
    },
  })
  return { start: () => void engine.start().catch(warnStart(log)) }
}
