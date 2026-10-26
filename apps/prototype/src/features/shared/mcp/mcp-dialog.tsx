import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { EMcpScope, type McpServer } from '../../settings/fixtures/settings-mcp'
import { McpForm } from './mcp-form'
import { formFromServer, formToDraft, type McpFormState } from './mcp-form-model'
import { parseMcpImport, readyDrafts, EMcpImportKind, type McpDraft } from './mcp-import'
import { McpImportPanel } from './mcp-import-panel'

export enum EMcpDialogTab {
  Form = 'form',
  Json = 'json',
}

const SCOPE_NOTES: Record<EMcpScope, string> = {
  [EMcpScope.Personal]: 'Applies to every project.',
  [EMcpScope.Project]: 'Applies to this project. Overrides a personal server with the same name.',
}

const SCOPE_LABELS: Record<EMcpScope, string> = {
  [EMcpScope.Personal]: 'personal',
  [EMcpScope.Project]: 'project',
}

function isTab(value: unknown): value is EMcpDialogTab {
  return Object.values(EMcpDialogTab).some((tab) => tab === value)
}

function McpDialogBody({
  scope,
  initial,
  initialTab,
  initialJson,
  onCancel,
  onSubmit,
}: {
  scope: EMcpScope
  initial: McpServer | null
  initialTab: EMcpDialogTab
  initialJson: string
  onCancel: () => void
  onSubmit: (drafts: McpDraft[]) => void
}) {
  const editing = initial !== null
  const [tab, setTab] = useState(initialTab)
  const [form, setForm] = useState<McpFormState>(() => formFromServer(initial))
  const [jsonText, setJsonText] = useState(initialJson)
  const [jsonName, setJsonName] = useState('')

  const result = parseMcpImport({ text: jsonText, name: jsonName })
  const drafts = result.kind === EMcpImportKind.Servers ? readyDrafts(result.entries) : []
  const formDraft = formToDraft(form)
  const onJson = tab === EMcpDialogTab.Json && !editing

  const handleChange = (patch: Partial<McpFormState>) =>
    setForm((current) => ({ ...current, ...patch }))

  const handleTabChange = (next: unknown) => {
    if (isTab(next)) setTab(next)
  }

  const handleSubmit = () => {
    if (onJson) return onSubmit(drafts)
    if (formDraft) onSubmit([formDraft])
  }

  const submitLabel = () => {
    if (editing) return 'Save'
    if (!onJson) return 'Add server'
    if (drafts.length === 0) return 'Add server'
    return drafts.length === 1 ? 'Add 1 server' : `Add ${drafts.length} servers`
  }

  const canSubmit = onJson ? drafts.length > 0 : formDraft !== null

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? `Edit ${SCOPE_LABELS[scope]} server` : 'Add MCP server'}
        </DialogTitle>
        <DialogDescription>{SCOPE_NOTES[scope]}</DialogDescription>
      </DialogHeader>
      {editing ? (
        <McpForm form={form} editing onChange={handleChange} />
      ) : (
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value={EMcpDialogTab.Form}>Form</TabsTrigger>
            <TabsTrigger value={EMcpDialogTab.Json}>Paste JSON</TabsTrigger>
          </TabsList>
          <TabsContent value={EMcpDialogTab.Form}>
            <McpForm form={form} editing={false} onChange={handleChange} />
          </TabsContent>
          <TabsContent value={EMcpDialogTab.Json}>
            <McpImportPanel
              text={jsonText}
              onTextChange={setJsonText}
              name={jsonName}
              onNameChange={setJsonName}
              result={result}
            />
          </TabsContent>
        </Tabs>
      )}
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          {submitLabel()}
        </Button>
      </DialogFooter>
    </>
  )
}

export function McpDialog({
  open,
  onOpenChange,
  scope,
  initial,
  initialTab = EMcpDialogTab.Form,
  initialJson = '',
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: EMcpScope
  initial: McpServer | null
  initialTab?: EMcpDialogTab
  initialJson?: string
  onSubmit: (drafts: McpDraft[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <McpDialogBody
          scope={scope}
          initial={initial}
          initialTab={initialTab}
          initialJson={initialJson}
          onCancel={() => onOpenChange(false)}
          onSubmit={(drafts) => {
            onSubmit(drafts)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
