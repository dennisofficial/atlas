import { ForbiddenException } from '@nestjs/common'

export class RepoAccessChecker {
  private readonly access = new Map<string, Promise<boolean>>()

  constructor(private readonly findToken: (args: { userId: string }) => Promise<string>) {}

  require(args: { userId: string; owner: string; repo: string }): Promise<boolean> {
    const key = `${args.userId}:${args.owner}/${args.repo}`
    const held = this.access.get(key)
    if (held !== undefined) return held

    const asked = this.check(args).catch((failure: unknown) => {
      this.access.delete(key)
      throw failure
    })
    this.access.set(key, asked)
    return asked
  }

  private async check(args: { userId: string; owner: string; repo: string }): Promise<boolean> {
    const token = await this.findToken({ userId: args.userId })
    const response = await fetch(`https://api.github.com/repos/${args.owner}/${args.repo}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    })
    if (response.status === 401) {
      this.access.delete(`${args.userId}:${args.owner}/${args.repo}`)
      throw new ForbiddenException(
        'the stored github token was rejected (expired or revoked) — reconnect github in settings',
      )
    }
    if (response.status === 404) {
      throw new ForbiddenException(`no access to ${args.owner}/${args.repo}`)
    }
    if (!response.ok) {
      throw new ForbiddenException(
        `github answered ${response.status} checking access to ${args.owner}/${args.repo}`,
      )
    }
    return true
  }
}
