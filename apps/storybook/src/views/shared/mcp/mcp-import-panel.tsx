import { useId, useRef } from 'react'
import { CheckIcon, UploadIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { EMcpAuth, EMcpTransport, type McpSpec } from '../../../fixtures/settings-mcp'
import {
  EMcpImportKind,
  EMcpImportStatus,
  type McpImportEntry,
  type McpImportResult,
} from './mcp-import'

const AUTH_LABELS: Record<EMcpAuth, string> = {
  [EMcpAuth.OAuth]: 'OAuth',
  [EMcpAuth.Bearer]: 'Bearer token',
  [EMcpAuth.None]: 'No auth',
}

function describeSpec(spec: McpSpec): string {
  if (spec.transport === EMcpTransport.Stdio) return 'Local'
  return `Remote · ${AUTH_LABELS[spec.auth.kind]}`
}

function PreviewRow({ entry }: { entry: McpImportEntry }) {
  const ready = entry.status === EMcpImportStatus.Ready
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <span
        className={
          ready
            ? 'mt-0.5 flex size-4 shrink-0 items-center justify-center text-success'
            : 'mt-0.5 flex size-4 shrink-0 items-center justify-center text-destructive'
        }
      >
        {ready ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
        <span className="sr-only">{ready ? 'Ready' : 'Error'}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium">{entry.name || 'Unnamed'}</span>
          {ready ? (
            <span className="text-xs text-muted-foreground">{describeSpec(entry.draft.spec)}</span>
          ) : null}
        </span>
        {ready
          ? entry.notes.map((note) => (
              <span key={note} className="text-xs text-muted-foreground">
                {note}
              </span>
            ))
          : null}
        {ready ? null : <span className="text-xs text-destructive">{entry.error}</span>}
      </div>
    </li>
  )
}

export function McpImportPanel({
  text,
  onTextChange,
  name,
  onNameChange,
  result,
}: {
  text: string
  onTextChange: (text: string) => void
  name: string
  onNameChange: (name: string) => void
  result: McpImportResult
}) {
  const nameId = useId()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    onTextChange(await file.text())
  }

  const entries = result.kind === EMcpImportKind.Servers ? result.entries : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Config</Label>
          <Button variant="ghost" size="xs" onClick={() => fileRef.current?.click()}>
            <UploadIcon data-icon="inline-start" />
            Upload .json
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload a .json file"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>
        <Textarea
          className="h-52 font-mono text-xs"
          spellCheck={false}
          aria-label="MCP JSON"
          placeholder={
            '{\n  "mcpServers": {\n    "linear": { "url": "https://mcp.linear.app/mcp" }\n  }\n}'
          }
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
        />
      </div>
      {result.kind === EMcpImportKind.Invalid ? (
        <p role="alert" className="text-xs text-destructive">
          {result.message}
        </p>
      ) : null}
      {result.kind === EMcpImportKind.NeedsName ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            className="font-mono text-xs"
            placeholder="linear"
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">This JSON is one server. Give it a name.</p>
        </div>
      ) : null}
      {entries.length > 0 ? (
        <ul className="divide-y overflow-hidden rounded-lg border" aria-label="Import preview">
          {entries.map((entry, index) => (
            <PreviewRow key={`${entry.name}-${index}`} entry={entry} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
