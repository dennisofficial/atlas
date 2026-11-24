import {
  type ContextFilesGcContent,
  type ContextFilesGcStore,
  type ContextFilesGcSummary,
  ControlPlane,
  runContextFilesGc,
} from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { contextSettingsOf, S3ContextContentStore } from '@dltech/atlas-control/s3'
import { db } from '@dltech/atlas-db'
import { graceMsOf } from './changes-gc'

export type ContextFilesGcDeps = {
  store: ContextFilesGcStore
  content: ContextFilesGcContent
  graceMs?: number | undefined
}

export const contextFilesGcDepsOf = (
  env: Record<string, string | undefined>,
): ContextFilesGcDeps => ({
  store: new ControlPlane({ store: new PostgresControlStore(db) }),
  content: new S3ContextContentStore({ settings: () => contextSettingsOf(env) }),
  graceMs: graceMsOf(env),
})

export const runContextFilesGcTask = (deps: ContextFilesGcDeps): Promise<ContextFilesGcSummary> =>
  runContextFilesGc(deps)
