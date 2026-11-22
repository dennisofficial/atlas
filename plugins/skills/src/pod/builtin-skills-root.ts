import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const builtInSkillsRoot = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')
