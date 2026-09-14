import { EDefinitionOrigin } from '@dltech/atlas-core'
import { z, ZodError } from 'zod'

import type { CloudClient } from '../../cloud/cloud-client'
import {
  EMcpRejection,
  McpSource,
  type LoadedMcpSpec,
  type McpSourceRead,
} from './sources'

const detailOf = (error: unknown): string => {
  if (error instanceof ZodError) return z.prettifyError(error)
  return error instanceof Error ? error.message : String(error)
}

export class RemoteMcpSource extends McpSource {
  readonly origin = EDefinitionOrigin.User
  private readonly client: CloudClient
  private readonly definedIn: string

  constructor(args: { client: CloudClient; url: string }) {
    super()
    this.client = args.client
    this.definedIn = `${args.url.replace(/\/+$/, '')}/v1/mcp-servers`
  }

  async load(): Promise<McpSourceRead> {
    try {
      const servers = await this.client.listMcpServers()
      const specs: LoadedMcpSpec[] = servers.map((server) => ({
        name: server.name,
        ...(server.transport === undefined ? {} : { transport: server.transport }),
        ...(server.disabled === undefined ? {} : { disabled: server.disabled }),
        ...(server.trusted === undefined ? {} : { trusted: server.trusted }),
        origin: this.origin,
        definedIn: this.definedIn,
      }))
      return { specs, rejections: [] }
    } catch (error) {
      return {
        specs: [],
        rejections: [
          {
            rejection:
              error instanceof ZodError ? EMcpRejection.BadEntry : EMcpRejection.Unreadable,
            name: undefined,
            definedIn: this.definedIn,
            origin: this.origin,
            detail: detailOf(error),
          },
        ],
      }
    }
  }
}
