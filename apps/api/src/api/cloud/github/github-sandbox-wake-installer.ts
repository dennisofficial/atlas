import { installServe, isDevServeVersion, type ServeInstaller } from '@dltech/atlas-wire'

export class DevServeInstallRefusedError extends Error {
  constructor(args: { name: string; version: string }) {
    super(
      `sandbox ${args.name} needs dev serve ${args.version}, which only the client that built it can upload — the wake fails rather than booting a release`,
    )
  }
}

export const releaseOnlyServeInstaller = (deps: { install?: ServeInstaller } = {}): ServeInstaller => {
  const install = deps.install ?? installServe
  return async (args) => {
    if (args.version !== undefined && isDevServeVersion(args.version)) {
      throw new DevServeInstallRefusedError({ name: args.sandbox.name, version: args.version })
    }
    await install(args)
  }
}
