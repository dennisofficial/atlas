import type { CloudClient } from './cloud-client'

export type VercelCredentialSnapshot = {
  configured: boolean
  tokenSet: boolean
  teamId: string
  projectId: string
}

export type VercelWrite = { ok: true } | { ok: false; message: string }

export type VercelUpdate = {
  token?: string
  teamId?: string
  projectId?: string
}

export class VercelCredentialStore {
  private view = { configured: false, teamId: '', projectId: '' }
  private draft: VercelUpdate = {}

  constructor(private readonly clientOf: () => CloudClient | null) {}

  signedIn(): boolean {
    return this.clientOf() !== null
  }

  snapshot(): VercelCredentialSnapshot {
    return {
      configured: this.view.configured,
      tokenSet: this.view.configured || this.draft.token !== undefined,
      teamId: this.draft.teamId ?? this.view.teamId,
      projectId: this.draft.projectId ?? this.view.projectId,
    }
  }

  async refresh(): Promise<void> {
    const client = this.clientOf()
    if (client === null) return
    const wire = await client.readVercel()
    this.view = {
      configured: wire.configured,
      teamId: wire.teamId ?? '',
      projectId: wire.vercelProjectId ?? '',
    }
  }

  async update(change: VercelUpdate): Promise<VercelWrite> {
    const client = this.clientOf()
    if (client === null) return { ok: true }
    const empty = emptyFieldMessage(change)
    if (empty !== null) return { ok: false, message: empty }
    this.draft = { ...this.draft, ...change }
    const { token } = this.draft
    const { teamId, projectId } = this.snapshot()
    if (!this.view.configured && token === undefined) return { ok: true }
    if (teamId === '' || projectId === '') return { ok: true }
    try {
      await client.saveVercel({
        teamId,
        vercelProjectId: projectId,
        ...(token === undefined ? {} : { token }),
      })
      this.draft = {}
      await this.refresh()
      return { ok: true }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  }

  async clear(): Promise<VercelWrite> {
    const client = this.clientOf()
    if (client === null) return { ok: true }
    this.draft = {}
    try {
      await client.removeVercel()
      await this.refresh()
      return { ok: true }
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const emptyFieldMessage = (change: VercelUpdate): string | null => {
  if (change.teamId !== undefined && change.teamId.trim() === '') return 'Team ID required'
  if (change.projectId !== undefined && change.projectId.trim() === '') return 'Project ID required'
  return null
}
