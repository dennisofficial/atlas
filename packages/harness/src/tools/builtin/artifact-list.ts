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
  'List the artifacts you have published, one row each: name, URL, status and when it was last published.',
  'Status is ready when the URL serves the last push, building while a push is uploading, and failed when a push was refused.',
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const rowOf = (artifact: ArtifactSummary): string =>
  [artifact.name, artifact.url, artifact.status, artifact.updatedAt].join(' | ')

const HEADER = ['name', 'url', 'status', 'updated'].join(' | ')

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
            'You have pushed no artifacts. Push one with artifact_push and it will appear here with its URL.',
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
