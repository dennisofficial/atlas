export function collapseHome(args: { cwd: string; home: string }): string {
  if (args.home.length === 0) return args.cwd
  if (args.cwd === args.home) return '~'
  if (args.cwd.startsWith(`${args.home}/`)) return `~${args.cwd.slice(args.home.length)}`
  return args.cwd
}

export function expandHome(args: { path: string; home: string }): string {
  if (args.home.length === 0) return args.path
  if (args.path === '~') return args.home
  if (args.path.startsWith('~/')) return `${args.home}${args.path.slice(1)}`
  return args.path
}
