import type { BuildContext, BuildExtension, BuildManifest } from '@trigger.dev/build'
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const TIER_FILE = '.env.api.production.enc'
const ENV_DEST_REL = 'envs'

// The trigger.dev worker image root is /app.
const WORKER_ROOT = '/app'

export function dotenvxTierExtension(): BuildExtension {
  return {
    name: 'DotenvxTierExtension',
    onBuildStart: (context) => {
      if (context.target === 'dev') return
      context.addLayer({
        id: 'dotenvx-envs-dir',
        deploy: {
          env: { DOTENVX_ENVS_DIR: `${WORKER_ROOT}/${ENV_DEST_REL}` },
          override: true,
        },
      })
    },
    onBuildComplete: async (context: BuildContext, manifest: BuildManifest) => {
      if (context.target === 'dev') return

      const source = join(context.workingDir, 'envs', TIER_FILE)
      if (!existsSync(source)) {
        throw new Error(
          `DotenvxTierExtension: ${TIER_FILE} not found at ${source}; the committed tier file must exist to ship it in the bundle.`,
        )
      }

      const destination = join(manifest.outputPath, ENV_DEST_REL)
      await mkdir(destination, { recursive: true })
      await cp(source, join(destination, TIER_FILE))
    },
  }
}
