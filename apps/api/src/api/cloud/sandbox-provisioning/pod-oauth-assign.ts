import type { Row, Tx } from '@dltech/atlas-db'

import { EConnectionStatus } from '../../platform/oauth-connections/oauth-connections.types'

type RowWriter = Pick<Tx, 'orm'>
type ConnectionId = Pick<Row<'OauthConnection'>, 'id'>

export async function assignCreatorConnections(args: {
  writer: RowWriter
  thread: Row<'Thread'>
  sandboxId: string
}): Promise<void> {
  const connections: ConnectionId[] = await args.writer.orm.public.OauthConnection.where({
    userId: args.thread.userId,
    status: EConnectionStatus.Active,
  })
    .select('id')
    .all()
  if (connections.length === 0) return
  await args.writer.orm.public.OauthConnectionSandbox.createAll(
    connections.map((connection) => ({
      connectionId: connection.id,
      sandboxId: args.sandboxId,
    })),
    { onConflict: 'skip' },
  )
}
