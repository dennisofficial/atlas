import type { PaneCommand } from './pane-command'

export const PANE_PATH = '/desktop/pane'

export const paneTargetIdOf = (args: { threadId: string; tabId: string }): string =>
  `pane:${args.threadId}:${args.tabId}`

const PROBE_TIMEOUT_MS = 2000

async function post(command: PaneCommand, signal?: AbortSignal): Promise<Response | null> {
  try {
    return await fetch(PANE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch {
    return null
  }
}

async function accepted(response: Response | null): Promise<boolean> {
  if (response === null || !response.ok) return false
  const body: unknown = await response.json().catch(() => null)
  const reply = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return reply.ok === true
}

let tail: Promise<unknown> = Promise.resolve()

function enqueue(run: () => Promise<boolean>): Promise<boolean> {
  const sent = tail.then(run)
  tail = sent.catch(() => false)
  return sent
}

export function sendPaneCommand(args: { id: string; command: PaneCommand }): Promise<boolean> {
  return enqueue(async () => accepted(await post({ ...args.command, id: args.id })))
}

let availability: Promise<boolean> | null = null

export function paneAvailable(): Promise<boolean> {
  availability ??= enqueue(async () =>
    accepted(await post({ kind: 'hide' }, AbortSignal.timeout(PROBE_TIMEOUT_MS))),
  )
  return availability
}

export function resetPaneAvailability(): void {
  availability = null
}
