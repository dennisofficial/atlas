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
    name: 'the github domain package and the v2 trigger worker stay off nest',
    roots: ['packages/github', 'apps/trigger'],
    forbidden: [
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/schedule',
      '@nestjs/throttler',
      'nestjs-trpc',
    ],
  },
  {
    name: 'the provider key path never depends on a model catalogue or a classifier',
    roots: ['packages/credentials'],
    forbidden: ['@dltech/atlas-models', '@dltech/atlas-classifier'],
  },
  {
    name: 'the classifier never depends on a model catalogue or a credential store',
    roots: ['packages/classifier'],
    forbidden: ['@dltech/atlas-models', '@dltech/atlas-credentials'],
  },
  {
    name: 'the quality review never depends on a host, a classifier or a network client',
    roots: ['plugins/quality'],
    forbidden: [
      '@dltech/atlas-host',
      '@dltech/atlas-classifier',
      '@dltech/atlas-models',
      '@dltech/atlas-credentials',
    ],
  },
  {
    name: 'the model catalogue never depends on the classifier',
    roots: ['packages/models'],
    forbidden: ['@dltech/atlas-classifier'],
  },
  {
    name: 'a plugin must not import another plugin',
    roots: ['plugins'],
    forbidden: [],
    forbids: importsAnotherPlugin,
  },
]
