import type { DirectoryEntry } from '@dltech/atlas-core'
import type { EChangeScope, ReadGitChangesReply } from '@dltech/atlas-wire'

import { GitChangesPort } from '../changes/git-changes.port'
import { LocalGitChanges } from '../changes/local-git-changes'
import type { LoadedFile, ViewedFile } from '../files/file-browser'
import type { MentionReader } from '../files/mention-reader'
import { rebaseMentionReader } from '../files/rebase-mention-reader'
import {
  threadProjectDirectory,
  type ThreadDirectorySources,
} from '../files/thread-project-directory'

export type ThreadPanels = { files: MentionReader; changes: GitChangesPort }

class ProjectDirectoryFiles implements MentionReader {
  private held: { root: string; reader: MentionReader } | undefined

  constructor(private readonly args: ThreadDirectorySources & { files: MentionReader }) {}

  private async reader(): Promise<MentionReader> {
    const root = await threadProjectDirectory(this.args)
    if (this.held?.root === root) return this.held.reader
    const reader = rebaseMentionReader({ reader: this.args.files, root })
    this.held = { root, reader }
    return reader
  }

  async list(directory: string): Promise<readonly DirectoryEntry[]> {
    return await (await this.reader()).list(directory)
  }

  async exists(path: string): Promise<boolean> {
    return await (await this.reader()).exists(path)
  }

  async load(path: string): Promise<LoadedFile> {
    return await (await this.reader()).load(path)
  }

  async read(path: string): Promise<ViewedFile> {
    return await (await this.reader()).read(path)
  }

  forget(): void {
    this.args.files.forget()
    this.held?.reader.forget()
  }
}

class ProjectDirectoryChanges extends GitChangesPort {
  constructor(private readonly args: ThreadDirectorySources) {
    super()
  }

  async read(args: { scope: EChangeScope }): Promise<ReadGitChangesReply> {
    const root = await threadProjectDirectory(this.args)
    return await new LocalGitChanges({ root }).read(args)
  }
}

export function threadPanels(
  args: ThreadDirectorySources & { files: MentionReader },
): ThreadPanels {
  return { files: new ProjectDirectoryFiles(args), changes: new ProjectDirectoryChanges(args) }
}
