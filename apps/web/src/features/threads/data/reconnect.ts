export const RECONNECT_BASE_MS = 1000
export const RECONNECT_CEILING_MS = 30000

export const reconnectDelayMs = (failures: number): number =>
  Math.min(RECONNECT_CEILING_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, failures - 1))
