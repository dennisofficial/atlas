import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { smokeCasesText, smokeDatasetManifest } from '../__fixtures__/smoke-dataset'
import { writeFileAtomic, writeJsonAtomic } from './atomic'

export const SMOKE_FEATURE_ID = 'calculator'

export async function materializeSmokeDataset({ workDirectory }: { workDirectory: string }): Promise<string> {
  const directory = join(workDirectory, 'smoke-dataset')
  await mkdir(directory, { recursive: true })
  const casesText = smokeCasesText()
  await writeFileAtomic({ path: join(directory, 'cases.jsonl'), content: casesText })
  const manifestPath = join(directory, 'manifest.json')
  await writeJsonAtomic({ path: manifestPath, value: smokeDatasetManifest({ casesText }) })
  return manifestPath
}
