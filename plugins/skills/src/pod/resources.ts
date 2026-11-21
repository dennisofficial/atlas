import { join } from 'node:path'

import { ECloudSetting, type PluginPodContext, type PodResource } from '@dltech/atlas-plugin-sdk'

import {
  buildCatalogue,
  catalogueOfSnapshot,
  skillsChangedOf,
  snapshottedCatalogueOf,
  snapshottedCatalogueSchema,
  type SnapshottedCatalogue,
} from './catalogue'
import type { CloudSkillSource, CloudSkillWriter } from './port'
import { REPO_SKILL_ROOTS } from './repo-source'

export const SKILLS_RESOURCE = 'skills'

export type SkillsPodOptions = {
  cloud(ctx: PluginPodContext): CloudSkillSource
  writes?(ctx: PluginPodContext): CloudSkillWriter | undefined
}

export const skillsResource = (options: SkillsPodOptions): PodResource<SnapshottedCatalogue> => ({
  name: SKILLS_RESOURCE,
  schema: snapshottedCatalogueSchema,
  watch: (directory) => ({ roots: REPO_SKILL_ROOTS.map((root) => join(directory, root)) }),
  cloud: [ECloudSetting.Skills],
  announce: (snapshot) => [skillsChangedOf(catalogueOfSnapshot(snapshot))],
  load: async ({ ctx, directory, signal }) =>
    snapshottedCatalogueOf(
      await buildCatalogue({ ctx, cloud: options.cloud(ctx), directory, signal }),
    ),
})
