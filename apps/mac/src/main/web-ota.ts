import { join } from 'node:path'

import { payloadRoot } from '../host/web-payload/ports'
import { WEB_MANIFEST_URL, WEB_MANIFEST_URL_ENV, WEB_ROOT_ENV } from '../host/web-payload/updater'

export function bundledWebRoot({ resourcesFolder }: { resourcesFolder: string }): string {
  return join(resourcesFolder, 'app', 'web', 'apps', 'web')
}

export function payloadWebRoot({ home, hash }: { home: string; hash: string }): string {
  return join(payloadRoot({ home, hash }), 'apps', 'web')
}

export function manifestUrlOf({ env }: { env: Record<string, string | undefined> }): string {
  const override = env[WEB_MANIFEST_URL_ENV]
  return override === undefined || override.length === 0 ? WEB_MANIFEST_URL : override
}

export function webRootOverrideOf({
  env,
}: {
  env: Record<string, string | undefined>
}): string | undefined {
  const override = env[WEB_ROOT_ENV]
  return override === undefined || override.length === 0 ? undefined : override
}
