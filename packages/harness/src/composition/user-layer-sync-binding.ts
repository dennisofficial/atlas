import { homedir } from 'node:os'

import { LogPort, NoticePort } from '@dltech/atlas-core'

import { cloudUserFilesClientFor } from '../cloud/user-files-client'
import { registerDisposable } from '../container/disposal'
import { registeredPortToken, type DependencyContainer } from '../container/injection'
import { CloudSessionStoreToken, ServeSessionToken } from '../container/tokens'
import { resolveProjectMemory } from '../memory/project-memory'
import { atlasDirectory } from '../store/paths'
import { createUserLayerSync } from '../user-layer-sync/factory'
import { NullUserLayerSync, UserLayerSyncPort } from '../user-layer-sync/port'

/**
 * The user layer (skills/instructions/memory) syncs only while the session has cloud authority; a
 * signed-out session composes the no-op port so the registry slot is never unbound. That authority
 * is the stored cloud session on a local launch and the `ServeSessionToken` attachment the
 * control plane issued on serve — the sandbox never stores a user session (cloud.json), so a
 * serve launch that read only the store would bind the Null no matter how signed-in the operator
 * is. The engine is registered at compose but NOT started on local launches — composing must never
 * open a socket (the local-first outage contract forbids a signed-in session from touching the
 * cloud when it is down), so `boot` is returned for the caller to fire: serve calls it at compose
 * (its boot IS the wake), the TUI on the first conversation open. Serve passes its own home
 * (`driveHome`) via `home`.
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
}): Promise<{ boot: () => Promise<void> }> {
  const { container } = args
  const log = container.resolve(registeredPortToken(LogPort))

  const notice = container.isRegistered(registeredPortToken(NoticePort), true)
    ? container.resolve(registeredPortToken(NoticePort))
    : undefined

  const session =
    (container.isRegistered(ServeSessionToken, true)
      ? container.resolve(ServeSessionToken)
      : undefined) ??
    (container.isRegistered(CloudSessionStoreToken, true)
      ? container.resolve(CloudSessionStoreToken).read()
      : null)

  const binding =
    args.override !== undefined
      ? {
          home: args.override.home,
          atlasHome: args.override.atlasHome,
          client: args.override.client,
        }
      : session === null || session === undefined
        ? null
        : {
            home: args.home ?? homedir(),
            atlasHome: atlasDirectory(),
            client: cloudUserFilesClientFor({ session, clientVersion: args.clientVersion }),
          }

  if (binding === null) {
    container.register(registeredPortToken(UserLayerSyncPort), { useValue: new NullUserLayerSync() })
    return { boot: async () => undefined }
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
    notice,
  })
  container.register(registeredPortToken(UserLayerSyncPort), { useValue: engine })
  registerDisposable({
    container,
    close: async () => {
      engine.stop()
    },
  })
  return { boot: () => engine.start() }
}
