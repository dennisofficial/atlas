import { z } from 'zod'

import {
  EDesktopUpdateState,
  type IDesktopUpdateStatus,
  type IDesktopUpdatesPort,
} from './update-routes'
import { EWebPayloadState } from './web-payload/updater'

export const UPDATE_ORIGIN_ENV = 'ATLAS_UPDATE_ORIGIN'
export const UPDATE_STATUS_PATH = '/update/status'
export const UPDATE_CHECK_LOCAL_PATH = '/update/check'
export const UPDATE_RESTART_LOCAL_PATH = '/update/restart'

const REQUEST_TIMEOUT_MS = 30_000

const webPayloadSchema = z.object({
  state: z.enum(EWebPayloadState),
  version: z.string().optional(),
  hash: z.string().optional(),
  builtAt: z.string().optional(),
  error: z.string().optional(),
})

const statusSchema = z.object({
  state: z.enum(EDesktopUpdateState),
  version: z.string().optional(),
  error: z.string().optional(),
  web: webPayloadSchema.optional(),
})

export function parseUpdateStatus({ input }: { input: unknown }): IDesktopUpdateStatus {
  return statusSchema.parse(input)
}

export function createUpdatesPort({ origin }: { origin: string }): IDesktopUpdatesPort {
  const send = async (pathname: string, method: 'GET' | 'POST'): Promise<Response> => {
    const response = await fetch(new URL(pathname, origin), {
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`${pathname} answered ${response.status}`)
    return response
  }

  const statusOf = async (response: Response): Promise<IDesktopUpdateStatus> =>
    parseUpdateStatus({ input: await response.json() })

  return {
    status: async () => statusOf(await send(UPDATE_STATUS_PATH, 'GET')),
    check: async () => statusOf(await send(UPDATE_CHECK_LOCAL_PATH, 'POST')),
    restart: async () => {
      await send(UPDATE_RESTART_LOCAL_PATH, 'POST')
    },
  }
}
