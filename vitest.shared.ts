import { fileURLToPath } from 'node:url'

import { incrementalTests } from '@dltech/vitest-incremental'
import type { PluginOption } from 'vite'
import { defineProject } from 'vitest/config'

import { bunBuiltins, bunConditionPackages, bunFileImports, tempDirExternals } from './vitest-setup/bun-loader'
import { absoluteMockPaths } from './vitest-setup/mock-paths'

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url))

export function atlasProject(params: {
  name: string
  setupFiles?: string[]
  plugins?: PluginOption[]
  globalInputs?: string[]
  include?: string[]
  pool?: 'forks' | 'threads'
  alias?: Array<{ find: string | RegExp; replacement: string }>
}) {
  return defineProject({
    plugins: [
      incrementalTests({ globalInputs: ['tsconfig.base.json', ...(params.globalInputs ?? [])] }),
      bunBuiltins(),
      bunFileImports(),
      absoluteMockPaths(),
      bunConditionPackages(),
      ...(params.plugins ?? []),
    ],
    resolve: {
      alias: [
        {
          find: /^@dltech\/atlas-wire$/,
          replacement: `${REPO_ROOT}packages/wire/src/index.ts`,
        },
        ...(params.alias ?? []),
      ],
    },
    test: {
      name: params.name,
      include: params.include ?? ['**/*.spec.{ts,tsx}'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.fixture/**'],
      setupFiles: [`${REPO_ROOT}vitest-setup/matchers.ts`, ...(params.setupFiles ?? [])],
      env: { ATLAS_TESTING: '1' },
      pool: params.pool ?? 'forks',
      testTimeout: 30_000,
      hookTimeout: 30_000,
      server: { deps: { inline: [/[\\/]zod[\\/]/], external: tempDirExternals() } },
    },
  })
}
