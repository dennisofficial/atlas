import { JsonlLog, SystemClock, atlasDirectory, registryFor } from '@dltech/atlas-harness'

/**
 * Boot-time failures happen before a container exists to resolve a LogPort out of, so the sites
 * that catch them build their own writer. Construction only builds paths and cannot throw on its
 * own, but a caller with no home at all must still never lose the boot to its own error reporting.
 */
export function durableOpLog(): JsonlLog | null {
  try {
    const home = atlasDirectory()
    return new JsonlLog({ home, registry: registryFor({ home }), clock: new SystemClock() })
  } catch {
    return null
  }
}
