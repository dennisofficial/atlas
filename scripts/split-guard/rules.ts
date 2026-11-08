import { posix } from 'node:path'

import type { SplitRule } from './scan'

const PLUGIN_PACKAGE_PREFIX = '@dltech/atlas-plugin-'
const PLUGIN_SDK_PACKAGE = '@dltech/atlas-plugin-sdk'

const pluginOf = (file: string): string | undefined => /^plugins\/([^/]+)\//.exec(file)?.[1]

const importsAnotherPlugin = (args: { file: string; specifier: string }): boolean => {
  const own = pluginOf(args.file)
  const specifier = args.specifier.startsWith('.')
    ? posix.join(posix.dirname(args.file), args.specifier)
    : args.specifier
  if (specifier === PLUGIN_SDK_PACKAGE || specifier.startsWith(`${PLUGIN_SDK_PACKAGE}/`)) {
    return false
  }
  if (specifier.startsWith(PLUGIN_PACKAGE_PREFIX)) {
    const name = specifier.slice(PLUGIN_PACKAGE_PREFIX.length).split('/')[0]
    return name !== own
  }
  const path = /(?:^|\/)plugins\/([^/]+)/.exec(specifier)?.[1]
  return path !== undefined && path !== own
}

export const SPLIT_RULES: readonly SplitRule[] = [
  {
    name: 'v2 must not depend on v1',
    roots: [
      'packages/agent',
      'packages/host',
      'packages/control',
      'packages/protocol',
      'apps/agent-host',
      'apps/api/src/api/cloud/agent-host',
      'apps/daemon',
    ],
    forbidden: [
      '@dltech/atlas-harness',
      '@dltech/atlas-wire',
      '@dltech/atlas-serve',
      '@dltech/atlas-agent-v1',
    ],
  },
  {
    name: 'v1 must not depend on v2',
    roots: ['packages/harness', 'packages/agent-v1', 'apps/serve'],
    forbidden: ['@dltech/atlas-agent', '@dltech/atlas-host', '@dltech/atlas-control'],
  },
  {
    name: 'a plugin must not import another plugin',
    roots: ['plugins'],
    forbidden: [],
    forbids: importsAnotherPlugin,
  },
]
