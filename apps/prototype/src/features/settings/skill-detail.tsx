'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { EMarkdownEditorVariant, MarkdownEditor } from '@dltech/atlas-ui/ai/markdown-editor'
import { Button } from '@dltech/atlas-ui/components/button'
import { Kbd } from '@dltech/atlas-ui/components/kbd'

import {
  ESkillFileKind,
  SKILL_OWNER_LABELS,
  SKILL_PRECEDENCE_COPY,
  fileKindOf,
  type ESkillOwner,
  type Skill,
} from './fixtures/settings-skills'
import { LibraryConfirmDialog } from './parts/library-confirm-dialog'
import { SkillBinaryCard } from './parts/skill-binary-card'
import { SkillConflict } from './parts/skill-conflict'
import { SkillDetailHeader } from './parts/skill-detail-header'
import { SkillFilePromptDialog, type SkillFilePrompt } from './parts/skill-file-dialogs'
import { SkillFileTree, type TreeAction } from './parts/skill-file-tree'
import { buildSkillTree } from './parts/skill-tree'
import { UnsavedGuardDialog } from './parts/skill-unsaved-dialog'
import { useSkills } from './use-skills'

type ConflictState = { mine: string; theirs: string }

function theirsVersion(content: string): string {
  return `${content.trimEnd()}\n\nAdded by another session while you were editing.\n`
}

export function SkillDetailPage({
  owner,
  skillName,
  listHref,
  forceConflict = false,
}: {
  owner: ESkillOwner
  skillName: string
  listHref: string
  forceConflict?: boolean
}) {
  const { skills } = useSkills({ owner })
  const skill = skills.find((candidate) => candidate.name === skillName)

  if (!skill) {
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
    <SkillDetail owner={owner} skill={skill} listHref={listHref} forceConflict={forceConflict} />
  )
}

function SkillDetail({
  owner,
  skill,
  listHref,
  forceConflict,
}: {
  owner: ESkillOwner
  skill: Skill
  listHref: string
  forceConflict: boolean
}) {
  const router = useRouter()
  const { saveFile, addFile, renamePath, deletePath, deleteSkills } = useSkills({ owner })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [guardOpen, setGuardOpen] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<SkillFilePrompt | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleteSkillOpen, setDeleteSkillOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)

  const currentPath = selectedPath ?? skill.files[0]?.path ?? 'SKILL.md'
  const file = skill.files.find((candidate) => candidate.path === currentPath) ?? skill.files[0]
  const savedContent = file?.content ?? ''
  const isText = file?.kind === ESkillFileKind.Text
  const draftValue = draft ?? savedContent
  const dirty = isText === true && draft !== null && draft !== savedContent
  const tree = buildSkillTree(skill.files.map((candidate) => candidate.path))
  const name = skill.name

  const openFile = (path: string) => {
    setSelectedPath(path)
    setDraft(null)
    setConflict(null)
  }
  const handleSelect = (path: string) => {
    if (dirty) {
      setGuardOpen(path)
      return
    }
    openFile(path)
  }
  const handleSave = () => {
    if (forceConflict && conflict === null) {
      setConflict({ mine: draftValue, theirs: theirsVersion(savedContent) })
      return
    }
    saveFile({ name, path: currentPath, content: draftValue })
    setDraft(null)
    setConflict(null)
  }
  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleSaveRef.current()
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
    saveFile({ name, path: currentPath, content: conflict?.mine ?? draftValue })
    setDraft(null)
    setConflict(null)
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
      const folder = !skill.files.some((candidate) => candidate.path === action.path)
      setPrompt({ kind: 'rename', path: action.path, folder })
      return
    }
    setPrompt({ kind: action.kind, basePath: action.path })
  }
  const handlePromptSubmit = ({
    prompt: done,
    target,
  }: {
    prompt: SkillFilePrompt
    target: string
    file?: File
  }) => {
    if (done.kind === 'rename') {
      renamePath({ name, from: done.path, to: target })
      if (currentPath === done.path || currentPath.startsWith(`${done.path}/`)) {
        setSelectedPath(target + currentPath.slice(done.path.length))
      }
      return
    }
    if (done.kind === 'new-file' || done.kind === 'upload') {
      addFile({ name, file: { path: target, kind: fileKindOf(target), content: '' } })
      openFile(target)
      return
    }
    addFile({ name, file: { path: `${target}/.gitkeep`, kind: ESkillFileKind.Text, content: '' } })
  }
  const handleConfirmDeletePath = () => {
    if (!pendingDelete) return
    deletePath({ name, path: pendingDelete })
    if (currentPath === pendingDelete || currentPath.startsWith(`${pendingDelete}/`)) {
      const remaining = skill.files.filter(
        (candidate) =>
          candidate.path !== pendingDelete && !candidate.path.startsWith(`${pendingDelete}/`),
      )
      setSelectedPath(remaining[0]?.path ?? null)
      setDraft(null)
    }
    setPendingDelete(null)
  }
  const handleConfirmDeleteSkill = () => {
    deleteSkills([name])
    router.push(listHref)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <SkillDetailHeader
        skill={skill}
        listHref={listHref}
        onDeleteSkill={() => setDeleteSkillOpen(true)}
      />
      <p className="-mt-2 text-sm text-muted-foreground">{SKILL_PRECEDENCE_COPY}</p>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] gap-4">
        <aside className="min-h-0 overflow-y-auto rounded-lg border bg-card p-2">
          <SkillFileTree
            nodes={tree}
            selected={currentPath}
            onSelect={handleSelect}
            onAction={handleAction}
          />
        </aside>

        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-muted-foreground">{currentPath}</span>
            {isText ? (
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
                onChange={(value) => setDraft(value)}
              />
            </div>
          ) : file ? (
            <SkillBinaryCard
              file={file}
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
        onDiscard={(target) => {
          if (target) openFile(target)
          setGuardOpen(null)
        }}
        onSaveAndSwitch={(target) => {
          saveFile({ name, path: currentPath, content: draftValue })
          if (target) openFile(target)
          setGuardOpen(null)
        }}
      />

      <SkillFilePromptDialog
        prompt={prompt}
        takenPaths={skill.files.map((candidate) => candidate.path)}
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
        title={`Delete ${skill.name}?`}
        description={`Removes this ${SKILL_OWNER_LABELS[owner].toLowerCase()} skill and every file in it. This cannot be undone.`}
        confirmLabel="Delete skill"
        onConfirm={handleConfirmDeleteSkill}
      />
    </div>
  )
}
