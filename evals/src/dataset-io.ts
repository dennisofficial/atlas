import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AnyEvalFeature } from './feature-registry'
import { parseDatasetManifest, validateDatasetStructure, type DatasetManifest } from './manifest'
import type { EvalCase } from './case'

const evalsRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export class DatasetNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatasetNotFoundError'
  }
}

export function defaultDatasetManifestPath({ suite }: { suite: string }): string {
  return join(evalsRoot, 'datasets', suite, 'manifest.json')
}

export type LoadedDatasetFile = {
  manifest: DatasetManifest
  manifestPath: string
  cases: readonly EvalCase[]
}

export async function loadDataset({
  feature,
  datasetPath,
  suite,
}: {
  feature: AnyEvalFeature
  datasetPath: string | null
  suite: string
}): Promise<LoadedDatasetFile> {
  const manifestPath = datasetPath ?? defaultDatasetManifestPath({ suite })
  let manifestText: string
  try {
    manifestText = await readFile(manifestPath, 'utf8')
  } catch {
    throw new DatasetNotFoundError(`dataset manifest not readable at ${manifestPath}`)
  }
  const manifest = parseDatasetManifest({ text: manifestText })
  if (manifest.featureId !== feature.id) {
    throw new DatasetNotFoundError(`manifest featureId ${manifest.featureId} != suite ${feature.id}`)
  }
  const casesPath = join(dirname(manifestPath), manifest.casesFile)
  let casesText: string
  try {
    casesText = await readFile(casesPath, 'utf8')
  } catch {
    throw new DatasetNotFoundError(`cases file not readable at ${casesPath}`)
  }
  const firstIssue = ({ error }: { error: { issues: readonly { message: string }[] } }): string =>
    error.issues[0]?.message ?? 'invalid'
  const validated = validateDatasetStructure({
    manifest,
    casesText,
    featureVersions: {
      inputSchemaVersion: feature.inputSchemaVersion,
      expectedSchemaVersion: feature.expectedSchemaVersion,
      rubricVersion: feature.rubricVersion,
    },
    validateInput: (input) => {
      const result = feature.inputSchema.safeParse(input)
      return result.success ? null : firstIssue({ error: result.error })
    },
    validateExpected: (expected) => {
      const result = feature.expectedSchema.safeParse(expected)
      return result.success ? null : firstIssue({ error: result.error })
    },
  })
  return { manifest, manifestPath, cases: validated.cases }
}
