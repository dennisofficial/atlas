export enum EReturnSurface {
  Web = 'web',
  Desktop = 'desktop',
  Ios = 'ios',
  Tui = 'tui',
}

export type ReturnTarget = { surface: EReturnSurface; port?: number | undefined }

export type ReturnCookie = ReturnTarget & { state: string }

const MIN_LOOPBACK_PORT = 1024
const MAX_LOOPBACK_PORT = 65535
const PORT_PATTERN = /^\d{1,5}$/

export const returnSurfaceOf = (value: string | null | undefined): EReturnSurface | undefined =>
  Object.values(EReturnSurface).find((surface) => surface === value)

export const returnPortOf = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined
  const port = typeof value === 'number' ? value : PORT_PATTERN.test(value) ? Number(value) : NaN
  return Number.isInteger(port) && port >= MIN_LOOPBACK_PORT && port <= MAX_LOOPBACK_PORT
    ? port
    : undefined
}

const WEB_TARGET: ReturnTarget = { surface: EReturnSurface.Web }

export const usableTargetOf = (target: ReturnTarget): ReturnTarget => {
  if (target.surface !== EReturnSurface.Tui) return { surface: target.surface }
  const port = returnPortOf(target.port)
  return port === undefined ? WEB_TARGET : { surface: EReturnSurface.Tui, port }
}

export const returnTargetOf = (args: {
  state: string
  cookie: ReturnCookie | undefined
  recorded: ReturnTarget
}): ReturnTarget =>
  usableTargetOf(
    args.cookie !== undefined && args.cookie.state === args.state ? args.cookie : args.recorded,
  )
