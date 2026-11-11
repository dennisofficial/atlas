import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { ArtifactSummary } from '@dltech/atlas-wire'
import { z } from 'zod'

import type { ArtifactPort } from '../../artifacts/artifact-port'

const inputSchema = z.strictObject({})

const description = [
  'List the artifacts you have published, one row each: name, URL, current version, status, size and when it last changed.',
  'Status is building while the server compiles the source, ready when the URL serves it, and failed when the build did not.',
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const kib = (bytes: number): string => `${(bytes / 1024).toFixed(bytes < 1024 * 10 ? 1 : 0)} KiB`

const rowOf = (artifact: ArtifactSummary): string =>
  [
    artifact.name,
    artifact.url,
    `v${artifact.currentVersion}`,
    artifact.status,
    `${kib(artifact.bytes)} (${artifact.fileCount} files)`,
    artifact.updatedAt,
  ].join(' | ')

const HEADER = ['name', 'url', 'version', 'status', 'bytes', 'updated'].join(' | ')

export class ListArtifactsTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'artifact_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly port: ArtifactPort) {
    super()
  }

  protected override async run({ signal }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    signal.throwIfAborted()
    try {
      const artifacts = await this.port.list()
      if (artifacts.length === 0) {
        return {
          ok: true,
          output: { artifacts: [] },
          modelText:
            'You have published no artifacts. Publish one with artifact_publish and it will appear here with its URL.',
        }
      }

      return {
        ok: true,
        output: { artifacts },
        modelText: [HEADER, ...artifacts.map(rowOf)].join('\n'),
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
