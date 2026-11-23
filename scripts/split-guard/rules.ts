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
      'apps/api/src/agent',
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
    name: 'the github domain package and the v2 trigger worker stay off nest and v1',
    roots: ['packages/github', 'apps/trigger'],
    forbidden: [
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/schedule',
      '@nestjs/throttler',
      'nestjs-trpc',
      '@dltech/atlas-harness',
      '@dltech/atlas-agent-v1',
      '@dltech/atlas-serve',
    ],
  },
  {
    name: 'the provider key path never depends on a model catalogue or a classifier',
    roots: ['packages/credentials'],
    forbidden: ['@dltech/atlas-models', '@dltech/atlas-classifier'],
  },
  {
    name: 'the classifier never depends on a model catalogue, a credential store or v1',
    roots: ['packages/classifier'],
    forbidden: ['@dltech/atlas-models', '@dltech/atlas-credentials', '@dltech/atlas-harness'],
  },
  {
    name: 'the quality review never depends on v1, a host or a network client',
    roots: ['packages/quality'],
    forbidden: [
      '@dltech/atlas-harness',
      '@dltech/atlas-agent-v1',
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
