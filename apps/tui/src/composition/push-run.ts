import { homedir } from 'node:os'

import {
  atlasCloudFile,
  atlasDirectory,
  atlasVaultKeyFile,
  CloudSessionStore,
  EPublishStage,
  loadPublishState,
  messageOf,
  hasChanges,
  planPush,
  publishBundle,
  PublishedBundleClient,
  savePublishState,
  scanPublishables,
  stateAfterPush,
  type PlanRow,
} from '@dltech/atlas-harness'

import { clientVersionHeader } from '../build/info'
import { EPickerOutcome, type PickerOutcome } from '../push/push-picker-model'
import { formatSize, publishedLine, PUSH_USAGE } from '../push/push-text'
import type { PushRequest } from './push'

const OK = 0
const REFUSED = 1

const STAGE_LINES: Readonly<Record<EPublishStage, string>> = {
  [EPublishStage.Packing]: 'packing…',
  [EPublishStage.Uploading]: 'uploading',
  [EPublishStage.Committing]: 'committing…',
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const complain = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

const defaultPicker = async (args: { rows: readonly PlanRow[]; showAll: boolean }): Promise<PickerOutcome> => {
  const { runPushPicker } = await import('../push/run-picker')
  return await runPushPicker(args)
}

export async function runPush({
  request,
  pick = defaultPicker,
}: {
  request: PushRequest
  pick?: typeof defaultPicker
}): Promise<number> {
  if (request.help || request.unknown.length > 0) {
    if (request.unknown.length > 0) complain(`unknown option: ${request.unknown.join(' ')}`)
    say(PUSH_USAGE.join('\n'))
    return request.unknown.length > 0 ? REFUSED : OK
  }

  const session = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() }).read()
  if (session === null) {
    complain('sign in to Atlas Cloud first (open atlas and run /login)')
    return REFUSED
  }

  const atlasHome = atlasDirectory()
  say('scanning skills, instructions and MCP config…')
  const items = await scanPublishables({ atlasHome, home: homedir() })
  if (items.length === 0) {
    complain('nothing to publish: no skills, ATLAS.md or mcp.json found')
    return REFUSED
  }

  const last = await loadPublishState({ atlasHome })
  const plan = planPush({ items, last })
  if (!hasChanges(plan) && last.version > 0 && !request.all) {
    say(`nothing changed since the last push (version ${last.version}) — atlas push --all to revise the selection`)
    return OK
  }
  if (plan.removed.length > 0) say(`${plan.removed.length} previously published item(s) no longer exist and will be dropped`)

  let selectedIds = new Set(plan.rows.filter((row) => row.selected).map((row) => row.item.id))
  if (!request.yes) {
    const outcome = await pick({ rows: plan.rows, showAll: request.all })
    if (outcome.kind === EPickerOutcome.Cancelled) {
      say('cancelled, nothing published')
      return REFUSED
    }
    selectedIds = new Set(outcome.ids)
  }

  const chosen = plan.rows.filter((row) => selectedIds.has(row.item.id)).map((row) => row.item)
  if (chosen.length === 0) {
    complain('nothing selected, nothing published')
    return REFUSED
  }

  const client = new PublishedBundleClient({ url: session.url, token: session.token, clientVersion: clientVersionHeader() })
  try {
    const summary = await publishBundle({
      items: chosen,
      client,
      onStage: ({ stage, bytes }) =>
        say(bytes === null ? STAGE_LINES[stage] : `${STAGE_LINES[stage]} ${formatSize(bytes)}…`),
    })
    await savePublishState({
      atlasHome,
      state: stateAfterPush({ rows: plan.rows, selectedIds, version: summary.version }),
    })
    say(publishedLine(summary))
    return OK
  } catch (error) {
    complain(`push failed: ${messageOf(error)}`)
    return REFUSED
  }
}
