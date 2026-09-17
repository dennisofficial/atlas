/**
 * `bin/atlas-dev` exports BUN_RUNTIME_TRANSPILER_CACHE_PATH so a source launch keeps a transpiler
 * cache no other command can write to. Exported means inherited, and Bun keys a cache entry by
 * source hash alone: a child bun that did not also inherit NODE_ENV=production writes `jsxDEV(...)`
 * into that cache, and react/jsx-dev-runtime exports jsxDEV as undefined in the production build
 * the launcher asks for. The next launch replays it and the interface never renders a frame.
 * https://bun.com/docs/runtime/modules#transpiler-cache
 */
const LAUNCHER_PRIVATE_KEYS: readonly string[] = ['BUN_RUNTIME_TRANSPILER_CACHE_PATH']

export const withoutLauncherPrivateEnv = (
  env: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  if (!LAUNCHER_PRIVATE_KEYS.some((key) => key in env)) return env

  const stripped = { ...env }
  for (const key of LAUNCHER_PRIVATE_KEYS) delete stripped[key]
  return stripped
}
