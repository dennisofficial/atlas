import { describe, expect, it } from 'bun:test';
import { EClientKind, parseClientMessage } from '../protocol';

describe('parseClientMessage', () => {
  it('parses input messages', () => {
    const parsed = parseClientMessage({ raw: JSON.stringify({ t: 'in', d: 'ls -la\r' }) });
    expect(parsed).toEqual({ kind: EClientKind.Input, data: 'ls -la\r' });
  });

  it('preserves escape sequences in input', () => {
    const parsed = parseClientMessage({ raw: JSON.stringify({ t: 'in', d: '[A' }) });
    expect(parsed).toEqual({ kind: EClientKind.Input, data: '[A' });
  });

  it('parses resize messages', () => {
    const parsed = parseClientMessage({ raw: JSON.stringify({ t: 'resize', cols: 120, rows: 40 }) });
    expect(parsed).toEqual({ kind: EClientKind.Resize, cols: 120, rows: 40 });
  });

  it('clamps absurd resize dimensions', () => {
    const parsed = parseClientMessage({ raw: JSON.stringify({ t: 'resize', cols: 99999, rows: 1 }) });
    expect(parsed).toEqual({ kind: EClientKind.Resize, cols: 500, rows: 4 });
  });

  it('rejects non-positive resize dimensions after clamping', () => {
    const parsed = parseClientMessage({ raw: JSON.stringify({ t: 'resize', cols: 0, rows: 30 }) });
    expect(parsed).toBeNull();
  });

  it('parses ping messages', () => {
    const parsed = parseClientMessage({ raw: JSON.stringify({ t: 'ping' }) });
    expect(parsed).toEqual({ kind: EClientKind.Ping });
  });

  it('returns null for malformed json', () => {
    expect(parseClientMessage({ raw: '{nope' })).toBeNull();
  });

  it('returns null for unknown message types', () => {
    expect(parseClientMessage({ raw: JSON.stringify({ t: 'exec', cmd: 'rm -rf /' }) })).toBeNull();
  });

  it('returns null for wrong field types', () => {
    expect(parseClientMessage({ raw: JSON.stringify({ t: 'in', d: 42 }) })).toBeNull();
    expect(parseClientMessage({ raw: JSON.stringify({ t: 'resize', cols: '80', rows: 24 }) })).toBeNull();
  });
});
