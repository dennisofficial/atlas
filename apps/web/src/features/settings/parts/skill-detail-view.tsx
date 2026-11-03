'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useState } from 'react'
import { toast } from 'sonner'
import type { SkillFileMeta } from '@dltech/atlas-wire/web'
import { isBuiltInSkillName } from '@dltech/atlas-harness/skill-catalogue'

import { EMarkdownEditorVariant, MarkdownEditor } from '@dltech/atlas-ui/ai/markdown-editor'
import { Button } from '@dltech/atlas-ui/components/button'
import { Kbd } from '@dltech/atlas-ui/components/kbd'

import { QueryGate } from '../data/shared/query-gate'
import { runAction } from '../data/shared/run-action'
import { bytesOfBase64, getSkillFile, removeSkill, saveSkillText } from '../data/shared/skills-api'
import { useSkillFiles, type SkillScopeTarget as Target } from '../data/shared/use-skills'
import { LibraryConfirmDialog } from './library-confirm-dialog'
import { SkillBinaryCard } from './skill-binary-card'
import { SkillConflict } from './skill-conflict'
import { defaultSkillPath } from './skill-default-path'
import { SkillDetailHeader } from './skill-detail-header'
import { SkillFilePromptDialog, type SkillFilePrompt } from './skill-file-dialogs'
import { SkillFileTree, type TreeAction } from './skill-file-tree'
import { SKILL_PRECEDENCE_COPY } from './skill-format'
import { buildSkillTree } from './skill-tree'
import { UnsavedGuardDialog } from './skill-unsaved-dialog'
import { SkillDetailSkeleton } from '../skeletons/skill-skeletons'

type ConflictState = { mine: string; theirs: string }

type LoadedFile = { content: string; revision: number }

export function SkillDetailPage({
  target,
  listHref,
  scopeLabel,
}: {
  target: Target & { skill: string }
  listHref: string
  scopeLabel: string
}) {
  const files = useSkillFiles(target)
  return (
    <QueryGate
      query={files.query}
      label="skill files"
      skeleton={<SkillDetailSkeleton />}
      wrap={(content) => <div className="flex min-h-0 flex-1 flex-col">{content}</div>}
    >
      {(metas) => (
        <SkillDetail
          target={target}
          metas={metas}
          listHref={listHref}
          scopeLabel={scopeLabel}
          files={files}
        />
      )}
    </QueryGate>
  )
}

function SkillDetail({
  target,
  metas,
  listHref,
  scopeLabel,
  files,
}: {
  target: Target & { skill: string }
  metas: SkillFileMeta[]
  listHref: string
  scopeLabel: string
  files: ReturnType<typeof useSkillFiles>
}) {
  const router = useRouter()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<(LoadedFile & { path: string }) | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [guardOpen, setGuardOpen] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<SkillFilePrompt | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleteSkillOpen, setDeleteSkillOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)

  const currentPath = selectedPath ?? defaultSkillPath({ metas }) ?? 'SKILL.md'
  const file = metas.find((candidate) => candidate.path === currentPath) ?? metas[0]
  const isText = file?.isText === true
  const tree = buildSkillTree(metas.map((candidate) => candidate.path))
  const name = target.skill
  const readOnly = isBuiltInSkillName(name) && metas.every((meta) => meta.revision === 0)
  // Built-in rows are served with revision 0; an overriding personal/project skill has revisions >= 1.

  const loadFile = async (path: string): Promise<LoadedFile | null> => {
    const meta = metas.find((candidate) => candidate.path === path)
    if (meta === undefined || !meta.isText) return null
    const remote = await getSkillFile({ ...target, path })
    return {
      content: new TextDecoder().decode(bytesOfBase64(remote.content)),
      revision: remote.revision,
    }
  }

  const openFile = (path: string) => {
    setSelectedPath(path)
    setDraft(null)
    setConflict(null)
    setLoaded(null)
  }

  useEffect(() => {
    if (!isText) return
    let cancelled = false
    void loadFile(currentPath).then((result) => {
      if (cancelled || result === null) return
      setLoaded({ ...result, path: currentPath })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, isText])

  const savedContent = loaded?.path === currentPath ? loaded.content : ''
  const baseRevision = loaded?.path === currentPath ? loaded.revision : 0
  const draftValue = draft ?? savedContent
  const dirty = isText && draft !== null && draft !== savedContent

  const saveDraft = async (value: string, revision: number): Promise<'saved' | 'conflict'> => {
    const result = await saveSkillText(
      { ...target, path: currentPath, baseRevision: revision },
      value,
    )
    if (result.outcome === 'saved') {
      setLoaded({ content: value, revision: result.revision, path: currentPath })
      return 'saved'
    }
    setLoaded({ content: result.theirs, revision: result.revision, path: currentPath })
    setConflict({ mine: value, theirs: result.theirs })
    return 'conflict'
  }

  const handleSelect = (path: string) => {
    if (dirty) {
      setGuardOpen(path)
      return
    }
    openFile(path)
  }
  const handleSave = () => {
    void runAction({
      work: async () => {
        const outcome = await saveDraft(draftValue, baseRevision)
        if (outcome === 'conflict') return
        toast.success(`Saved ${currentPath}`)
        setDraft(null)
        setConflict(null)
        files.query.reload()
      },
    })
  }
  const handleSaveKey = useEffectEvent(handleSave)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleSaveKey()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const handleDiscard = () => {
    setDraft(null)
    setConflict(null)
  }
  const handleKeepMine = () => {
    const value = conflict?.mine ?? draftValue
    setConflict(null)
    void runAction({
      work: async () => {
        const fresh = await loadFile(currentPath)
        const outcome = await saveDraft(value, fresh?.revision ?? baseRevision)
        if (outcome === 'conflict') return
        setDraft(null)
        files.query.reload()
      },
      success: `Saved ${currentPath}`,
    })
  }
  const handleTakeTheirs = () => {
    setDraft(conflict?.theirs ?? null)
    setConflict(null)
  }
  const handleAction = (action: TreeAction) => {
    if (action.kind === 'delete') {
      setPendingDelete(action.path)
      return
    }
    if (action.kind === 'rename') {
      const folder = !metas.some((candidate) => candidate.path === action.path)
      setPrompt({ kind: 'rename', path: action.path, folder })
      return
    }
    setPrompt({ kind: action.kind, basePath: action.path })
  }
  const handlePromptSubmit = ({
    prompt: done,
    target: targetPath,
    file: picked,
  }: {
    prompt: SkillFilePrompt
    target: string
    file?: File
  }) => {
    void runAction({
      work: async () => {
        if (done.kind === 'rename') {
          await files.renamePath({ from: done.path, to: targetPath })
          if (currentPath === done.path || currentPath.startsWith(`${done.path}/`)) {
            openFile(targetPath + currentPath.slice(done.path.length))
          }
          return
        }
        if (done.kind === 'new-file' || done.kind === 'upload') {
          if (picked !== undefined) {
            await files.uploadFile(targetPath, picked)
          } else {
            await files.addTextFile(targetPath)
          }
          openFile(targetPath)
          return
        }
        await files.addTextFile(`${targetPath}/.gitkeep`)
      },
    })
  }
  const handleConfirmDeletePath = () => {
    if (!pendingDelete) return
    const path = pendingDelete
    setPendingDelete(null)
    void runAction({
      work: () => files.deletePath(path),
      success: `Deleted ${path}`,
    }).then(() => {
      if (currentPath === path || currentPath.startsWith(`${path}/`)) {
        setSelectedPath(null)
        setDraft(null)
        setLoaded(null)
      }
    })
  }
  const handleConfirmDeleteSkill = () => {
    setDeleteSkillOpen(false)
    void runAction({
      work: () => removeSkill(target).then(() => undefined),
      success: `Deleted ${name}`,
    }).then((done) => {
      if (done) router.push(listHref)
    })
  }
  const handleDownload = () => {
    if (file === undefined) return
    void getSkillFile({ ...target, path: file.path }).then((remote) => {
      const bytes = bytesOfBase64(remote.content)
      const url = URL.createObjectURL(new Blob([bytes]))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.path.split('/').at(-1) ?? file.path
      anchor.click()
      URL.revokeObjectURL(url)
    })
  }

  if (metas.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <h1 className="text-lg font-semibold">Skill not found</h1>
        <p className="text-sm text-muted-foreground">It may have been deleted in this session.</p>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={listHref} />}>
          Back to skills
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <SkillDetailHeader
        name={name}
        updatedAt={file?.updatedAt ?? null}
        listHref={listHref}
        readOnly={readOnly}
        onDeleteSkill={() => setDeleteSkillOpen(true)}
      />
      <p className="-mt-2 text-sm text-muted-foreground">{SKILL_PRECEDENCE_COPY}</p>
      {readOnly ? (
        <p className="-mt-2 text-sm text-muted-foreground">
          Built-in skills ship with Atlas and are read-only. Create a personal or project skill with
          the same name to override it.
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-4">
        <aside className="min-h-0 overflow-y-auto rounded-lg border bg-card p-2">
          <SkillFileTree
            nodes={tree}
            selected={currentPath}
            readOnly={readOnly}
            onSelect={handleSelect}
            onAction={handleAction}
          />
        </aside>

        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-muted-foreground">{currentPath}</span>
            {isText && !readOnly ? (
              <div className="flex items-center gap-2">
                {dirty ? (
                  <span className="text-xs text-muted-foreground">Unsaved changes</span>
                ) : null}
                {dirty ? (
                  <Button variant="ghost" size="sm" onClick={handleDiscard}>
                    Discard
                  </Button>
                ) : null}
                <Button size="sm" disabled={!dirty} onClick={handleSave}>
                  Save
                  <Kbd className="ml-1">⌘S</Kbd>
                </Button>
              </div>
            ) : null}
          </div>
          {conflict ? (
            <SkillConflict
              mine={conflict.mine}
              theirs={conflict.theirs}
              onKeepMine={handleKeepMine}
              onTakeTheirs={handleTakeTheirs}
            />
          ) : isText ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border [container-type:size] [--markdown-document-inline-padding:1.25rem] [--markdown-document-min-height:calc(100cqh-var(--markdown-toolbar-height,3.1rem))]">
              <MarkdownEditor
                variant={EMarkdownEditorVariant.Document}
                ariaLabel={currentPath}
                value={draftValue}
                readOnly={readOnly}
                onChange={(value) => setDraft(value)}
              />
            </div>
          ) : file ? (
            <SkillBinaryCard
              path={file.path}
              sizeBytes={file.sizeBytes}
              readOnly={readOnly}
              onDownload={handleDownload}
              onReplace={() =>
                setPrompt({
                  kind: 'upload',
                  basePath: file.path.split('/').slice(0, -1).join('/'),
                })
              }
              onDelete={() => setPendingDelete(file.path)}
            />
          ) : null}
        </section>
      </div>

      <UnsavedGuardDialog
        targetPath={guardOpen}
        currentPath={currentPath}
        onKeepEditing={() => setGuardOpen(null)}
        onDiscard={(targetPath) => {
          if (targetPath) openFile(targetPath)
          setGuardOpen(null)
        }}
        onSaveAndSwitch={(targetPath) => {
          void saveDraft(draftValue, baseRevision).then(() => {
            files.query.reload()
            if (targetPath) openFile(targetPath)
            setGuardOpen(null)
          })
        }}
      />

      <SkillFilePromptDialog
        prompt={prompt}
        takenPaths={metas.map((candidate) => candidate.path)}
        onSubmit={handlePromptSubmit}
        onClose={() => setPrompt(null)}
      />

      <LibraryConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={`Delete ${pendingDelete ?? ''}?`}
        description="The file is removed from the skill. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleConfirmDeletePath}
      />

      <LibraryConfirmDialog
        open={deleteSkillOpen}
        onOpenChange={setDeleteSkillOpen}
        title={`Delete ${name}?`}
        description={`Removes this ${scopeLabel.toLowerCase()} skill and every file in it. This cannot be undone.`}
        confirmLabel="Delete skill"
        onConfirm={handleConfirmDeleteSkill}
      />
    </div>
  )
}
