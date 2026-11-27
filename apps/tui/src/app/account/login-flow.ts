export enum ELoginFlow {
  Loopback = 'loopback',
  DeviceCode = 'device-code',
}

const asks = (env: Record<string, string | undefined>, name: string): boolean => {
  const value = env[name]
  return value !== undefined && value !== ''
}

export const loginFlowOf = (args: {
  env: Record<string, string | undefined>
  platform: string
}): ELoginFlow => {
  if (asks(args.env, 'SSH_CONNECTION') || asks(args.env, 'SSH_TTY')) return ELoginFlow.DeviceCode
  const headlessLinux =
    args.platform === 'linux' && !asks(args.env, 'DISPLAY') && !asks(args.env, 'WAYLAND_DISPLAY')
  return headlessLinux ? ELoginFlow.DeviceCode : ELoginFlow.Loopback
}
