import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { wireWorkspaceSpecSchema, type FetchWorkspaceSpec } from './workspace-spec'

const BOOTSTRAP_DIRECTORY = 'bootstrap'
const WORKSPACE_SPEC_FILE = 'workspace-spec.json'

export function bootstrapWorkspaceSpecFetcher(args: { atlasHome: string }): FetchWorkspaceSpec {
  const path = join(args.atlasHome, BOOTSTRAP_DIRECTORY, WORKSPACE_SPEC_FILE)

  return async () => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      throw new Error(
        `the workspace spec the laptop wrote is not in the sandbox home at ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    return wireWorkspaceSpecSchema.parse(JSON.parse(text))
  }
}
