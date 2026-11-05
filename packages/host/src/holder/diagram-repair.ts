import {
  DIAGRAM_REPAIR_SYSTEM,
  diagramKey,
  diagramRepairPrompt,
  repairedSourceOf,
  toEventId,
  type Assembled,
  type InboxEntry,
  type ModelPort,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { inboxRepairDiagramSchema, type InboxRepairDiagram } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { AppendBody, SessionRecord } from './record/record-adapter'

export type RepairDiagramArgs = {
  model: ModelPort
  entry: InboxEntry
  record: SessionRecord
  threadId: ThreadId
  runId: RunId
  signal: AbortSignal
  log?: LogPort | undefined
}

const parsePayload = (payload: string): InboxRepairDiagram | undefined => {
  try {
    const parsed = inboxRepairDiagramSchema.safeParse(JSON.parse(payload))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

const assembledFor = (payload: InboxRepairDiagram): Assembled => ({
  system: [{ text: DIAGRAM_REPAIR_SYSTEM }],
  messages: [
    {
      message: {
        role: 'user',
        content: [{ type: 'text', text: diagramRepairPrompt(payload) }],
      },
      origin: { eventId: toEventId(payload.messageId), seq: 0 },
    },
  ],
})

const askModel = async (args: {
  model: ModelPort
  payload: InboxRepairDiagram
  signal: AbortSignal
}): Promise<string | undefined> => {
  const result = await args.model.step({
    assembled: assembledFor(args.payload),
    tools: [],
    signal: args.signal,
  })
  const reply = result.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
  return repairedSourceOf(reply)
}

const refuse = (args: { log?: LogPort | undefined; entry: InboxEntry; reason: string }): void =>
  args.log?.warn({
    source: 'holder.diagram-repair',
    message: `inbox entry ${args.entry.inboxId} repair-diagram produced no repair: ${args.reason}`,
  })

export const repairDiagram = async (args: RepairDiagramArgs): Promise<void> => {
  const { entry, log } = args
  const consumed: AppendBody = { type: 'input-consumed', inboxId: entry.inboxId }
  const append = (drafts: AppendBody[]) =>
    args.record.append({ threadId: args.threadId, runId: args.runId, drafts })
  const payload = parsePayload(entry.payload)
  if (payload === undefined) {
    refuse({ log, entry, reason: 'unreadable payload' })
    await append([consumed])
    return
  }
  let repaired: string | undefined
  try {
    repaired = await askModel({ model: args.model, payload, signal: args.signal })
  } catch (error) {
    log?.warn({
      source: 'holder.diagram-repair',
      message: `repair model call for inbox entry ${entry.inboxId} failed`,
      ...logFieldsOf({ error }),
    })
  }
  if (repaired === undefined || diagramKey(repaired) === diagramKey(payload.source)) {
    refuse({ log, entry, reason: repaired === undefined ? 'no model reply' : 'unchanged source' })
    await append([consumed])
    return
  }
  await append([
    {
      type: 'diagram-repaired',
      messageId: toEventId(payload.messageId),
      original: payload.source,
      repaired,
      modelId: args.model.identity.modelId,
    },
    consumed,
  ])
}
