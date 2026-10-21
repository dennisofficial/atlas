import { fileURLToPath } from 'node:url'

import { atlasProject } from '../../vitest.shared'

export default atlasProject({
  name: 'web',
  alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }],
})
