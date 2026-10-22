import { atlasProject } from '../../vitest.shared'

export default atlasProject({ name: 'db', globalInputs: ['packages/db/migrations/**/ops.json'] })
