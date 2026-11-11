import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { z } from 'zod'

import type { ArtifactPort } from '../../artifacts/artifact-port'

const inputSchema = z.strictObject({
  slug: z.string().min(1).max(120),
})

const description = [
  'Unpublish an artifact, which is destructive: its URL stops serving, every version of its source is deleted, and anyone holding the link gets nothing.',
  'It takes the slug and asks for no confirmation, so call it only when the slug is certain.',
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class UnpublishArtifactTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'artifact_unpublish'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly port: ArtifactPort) {
    super()
  }

  protected override async run({
    input,
    signal,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    signal.throwIfAborted()
    try {
      await this.port.unpublish({ slug: input.slug })
      return {
        ok: true,
        output: { slug: input.slug, unpublished: true },
        modelText: `${input.slug} is unpublished: its URL no longer serves and its source is gone. Publishing the same name again starts a new artifact.`,
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
