import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { catalogOf, findCard, tallySpend, type SpendTally } from '@dltech/atlas-core'
import { generatedCards } from '@dltech/atlas-models'
import { readTurnsReplySchema, type WireTurn } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

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

export async function readSpendFromApi(args: { threadId: string }): Promise<SpendTally> {
  return spendOf(await cloudCall(api.threadTurns.list.query({ threadId: args.threadId })))
}

type SpendWatch = { stop: () => void; refresh: () => void }

function latestSpendWatch(args: {
  read: () => Promise<SpendTally>
  onSpend: (spend: SpendTally) => void
  detach?: () => void
}): SpendWatch {
  let active = true
  let latest = 0
  const refresh = (): void => {
    latest += 1
    const mine = latest
    void args
      .read()
      .then((spend) => {
        if (active && mine === latest) args.onSpend(spend)
      })
      .catch(() => undefined)
  }
  return {
    refresh,
    stop: () => {
      active = false
      args.detach?.()
    },
  }
}

export function watchSpend(args: {
  channel: SpendChannel
  threadId: string
  onSpend: (spend: SpendTally) => void
}): SpendWatch {
  const { channel, threadId, onSpend } = args
  const watch = latestSpendWatch({
    read: () => readSpend({ channel, threadId }),
    onSpend,
    detach: () => {
      for (const off of offs) off()
    },
  })
  const offs = [channel.onReady(watch.refresh), channel.onReload(watch.refresh)]
  watch.refresh()
  return watch
}

export function watchApiSpend(args: {
  threadId: string
  onSpend: (spend: SpendTally) => void
}): SpendWatch {
  const watch = latestSpendWatch({
    read: () => readSpendFromApi({ threadId: args.threadId }),
    onSpend: args.onSpend,
  })
  watch.refresh()
  return watch
}
