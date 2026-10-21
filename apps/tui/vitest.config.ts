import { mergeConfig } from 'vitest/config'

import { atlasProject } from '../../vitest.shared'

export default mergeConfig(
  atlasProject({ name: 'tui', setupFiles: ['./src/__tests__/test-home-setup.ts'] }),
  { test: { maxWorkers: 8, sequence: { groupId: 1 } } },
)
