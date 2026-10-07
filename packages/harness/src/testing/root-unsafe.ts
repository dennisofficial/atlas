import { it } from 'bun:test'

export const runningAsRoot = (): boolean =>
  typeof process.geteuid === 'function' && process.geteuid() === 0

export const ROOT_PERMISSION_NOTE =
  'this spec chmods a file to 0o000 and asserts the resulting denial, but root reads through permission bits — the premise is void, so it only runs as a non-root user'

export function itUnlessRoot(
  label: string,
  fn: (() => void | Promise<unknown>) | undefined,
  timeout?: number,
): void {
  if (runningAsRoot()) {
    it.skip(label, fn ?? (() => undefined))
    return
  }
  it(label, fn ?? (() => undefined), timeout)
}
