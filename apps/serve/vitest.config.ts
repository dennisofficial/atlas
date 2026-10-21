import { atlasProject } from '../../vitest.shared'

export default atlasProject({ name: 'serve', setupFiles: ['./src/__tests__/test-home-setup.ts'] })
