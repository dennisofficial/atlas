import { describe, expect, it } from 'bun:test'

import { buildPluginTypes, workspaceRootOfThisScript } from '../../../scripts/generate-plugin-types'
import { PLUGIN_TYPES_TEXT } from '../plugin-types.generated'

describe('the committed plugin types', () => {
  it('match what the generator produces from the current sources', async () => {
    const built = await buildPluginTypes({
      sourceRoot: workspaceRootOfThisScript(),
    })

    expect(PLUGIN_TYPES_TEXT).toBe(built)
  }, 180_000)
})
