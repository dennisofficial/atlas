const UNSAFE_DEVICE_CHARS = /[^a-zA-Z0-9-]/g

const extensionStart = (basename: string): number => {
  const dot = basename.lastIndexOf('.')
  return dot > 0 && dot < basename.length - 1 ? dot : -1
}

export function conflictCopyName(args: { path: string; deviceId: string }): string {
  const marker = `.conflict-${args.deviceId.replace(UNSAFE_DEVICE_CHARS, '-')}`
  const slash = args.path.lastIndexOf('/')
  const dir = args.path.slice(0, slash + 1)
  const basename = args.path.slice(slash + 1)

  const dot = extensionStart(basename)
  if (dot === -1) return `${dir}${basename}${marker}`
  return `${dir}${basename.slice(0, dot)}${marker}${basename.slice(dot)}`
}
