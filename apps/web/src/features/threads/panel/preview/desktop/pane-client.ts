import type { PaneCommand } from './pane-command'

export const PANE_PATH = '/desktop/pane'

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

export async function sendPaneCommand(command: PaneCommand): Promise<boolean> {
  return accepted(await post(command))
}

let availability: Promise<boolean> | null = null

export function paneAvailable(): Promise<boolean> {
  availability ??= post({ kind: 'hide' }, AbortSignal.timeout(PROBE_TIMEOUT_MS)).then(accepted)
  return availability
}

export function resetPaneAvailability(): void {
  availability = null
}
