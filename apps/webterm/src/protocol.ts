export enum EClientKind {
  Input = 'in',
  Resize = 'resize',
  Ping = 'ping',
}

export type ClientMessage =
  | { kind: EClientKind.Input; data: string }
  | { kind: EClientKind.Resize; cols: number; rows: number }
  | { kind: EClientKind.Ping };

const MIN_DIMENSION = 4;
const MAX_DIMENSION = 500;

function clampDimension({ raw }: { raw: number }): number {
  const value = Math.trunc(raw);
  if (Number.isNaN(value) || value <= 0) return 0;
  return Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, value));
}

export function parseClientMessage({ raw }: { raw: string }): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  if (record.t === 'in' && typeof record.d === 'string') {
    return { kind: EClientKind.Input, data: record.d };
  }
  if (record.t === 'resize' && typeof record.cols === 'number' && typeof record.rows === 'number') {
    const cols = clampDimension({ raw: record.cols });
    const rows = clampDimension({ raw: record.rows });
    if (cols === 0 || rows === 0) return null;
    return { kind: EClientKind.Resize, cols, rows };
  }
  if (record.t === 'ping') {
    return { kind: EClientKind.Ping };
  }
  return null;
}
