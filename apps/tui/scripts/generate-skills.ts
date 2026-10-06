#!/usr/bin/env bun
import { join, relative } from 'node:path'

import { generateSkills } from '../../../packages/harness/scripts/generate-skills'

const repoRoot = join(import.meta.dir, '..', '..', '..')
const result = await generateSkills()

console.log(
  `skills → ${relative(repoRoot, join(repoRoot, 'packages', 'harness', 'src', 'skills', 'manifest.generated.ts'))} (${result.skills} skills, ${result.resources} bundled resources in ${result.modules} modules)`,
)
