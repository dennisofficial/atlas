import { basename, dirname, extname } from 'node:path'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import { readOriginIdentity } from '../memory/origin-identity'
import { projectPluginsDirectory, userPluginsDirectory } from '../settings/paths'

import { listPluginPaths, loadPluginDirectory } from './directory-source'
import type { LoadedRepoPlugin, RepoPluginRefusal } from './validate'

export type RepoPluginsRead = {
  plugins: readonly LoadedRepoPlugin[]
  refusals: readonly RepoPluginRefusal[]
  withheld: readonly string[]
  trustKey: string
}

const INDEX_NAME = /^index\.tsx?$/

const pluginName = (path: string): string =>
  INDEX_NAME.test(basename(path)) ? basename(dirname(path)) : basename(path, extname(path))

const trustedEntries = (trustedRepos: string): ReadonlySet<string> =>
  new Set(
    trustedRepos
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== ''),
  )

export async function readRepoPlugins(args: {
  cwd: string
  trustedRepos: string
}): Promise<RepoPluginsRead> {
  const trustKey = (await readOriginIdentity(args.cwd)) ?? args.cwd
  const trusted = trustedEntries(args.trustedRepos).has(trustKey.toLowerCase())
  const projectDirectory = projectPluginsDirectory(args.cwd)

  const user = await loadPluginDirectory({
    directory: userPluginsDirectory(),
    origin: EDefinitionOrigin.User,
  })

  if (!trusted) {
    const listing = await listPluginPaths(projectDirectory)
    return { ...user, withheld: listing.paths.map(pluginName), trustKey }
  }

  const project = await loadPluginDirectory({
    directory: projectDirectory,
    origin: EDefinitionOrigin.Project,
  })

  return {
    plugins: [...user.plugins, ...project.plugins],
    refusals: [...user.refusals, ...project.refusals],
    withheld: [],
    trustKey,
  }
}
