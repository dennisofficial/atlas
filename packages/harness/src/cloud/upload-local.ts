import { FileMcpSource } from '../mcp/config/sources'
import type { CloudClient } from './cloud-client'

export type { CloudSyncCounts } from './sync-accounts'

export async function uploadLocalMcp(args: { client: CloudClient }): Promise<number> {
  const read = await FileMcpSource.user().load()

  let uploaded = 0
  for (const spec of read.specs) {
    await args.client.putMcpServer({
      name: spec.name,
      ...(spec.transport === undefined ? {} : { transport: spec.transport }),
      ...(spec.disabled === undefined ? {} : { disabled: spec.disabled }),
    })
    uploaded += 1
  }
  return uploaded
}
