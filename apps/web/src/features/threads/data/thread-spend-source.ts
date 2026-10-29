import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { catalogOf, findCard, tallySpend, type SpendTally } from '@dltech/atlas-core'
import { generatedCards } from '@dltech/atlas-models'
import { readTurnsReplySchema, type WireTurn } from '@dltech/atlas-wire/web'

export type SpendChannel = Pick<RemoteDeltaChannel, 'request' | 'onReady' | 'onReload'>

let catalog: ReturnType<typeof catalogOf> | undefined

const catalogue = () => {
  catalog ??= catalogOf(generatedCards())
  return catalog
}

export function spendOf(turns: readonly WireTurn[]): SpendTally {
  return tallySpend({
    rows: turns,
    priceOf: (ref) => findCard({ catalog: catalogue(), ref })?.cost,
  })
}

export async function readSpend(args: {
  channel: Pick<RemoteDeltaChannel, 'request'>
  threadId: string
}): Promise<SpendTally> {
  const reply = readTurnsReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.ReadTurns,
      params: { threadId: args.threadId },
    }),
  )
  return spendOf([...reply.own, ...reply.delegated])
}

export function watchSpend(args: {
  channel: SpendChannel
  threadId: string
  onSpend: (spend: SpendTally) => void
}): { stop: () => void; refresh: () => void } {
  const { channel, threadId, onSpend } = args
  let active = true
  let latest = 0
  const refresh = (): void => {
    latest += 1
    const mine = latest
    void readSpend({ channel, threadId })
      .then((spend) => {
        if (active && mine === latest) onSpend(spend)
      })
      .catch(() => undefined)
  }
  const offs = [channel.onReady(refresh), channel.onReload(refresh)]
  refresh()
  return {
    refresh,
    stop: () => {
      active = false
      for (const off of offs) off()
    },
  }
}
