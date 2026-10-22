import { useState } from 'react'
import { PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@dltech/atlas-ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import { EMcpTransport } from '../../fixtures/project-settings'

export interface McpServerDraft {
  id: string
  transport: EMcpTransport
  target: string
}

const SERVER_ID = /^[a-zA-Z0-9_-]+$/

function isTransport(value: unknown): value is EMcpTransport {
  return Object.values(EMcpTransport).some((transport) => transport === value)
}

export function AddMcpServerDialog({
  defaultOpen = false,
  initialTransport = EMcpTransport.Stdio,
  onAdd,
}: {
  defaultOpen?: boolean
  initialTransport?: EMcpTransport
  onAdd: (draft: McpServerDraft) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [id, setId] = useState('')
  const [transport, setTransport] = useState(initialTransport)
  const [target, setTarget] = useState('')
  const [extra, setExtra] = useState('')
  const isStdio = transport === EMcpTransport.Stdio
  const canSave = SERVER_ID.test(id) && target.trim() !== ''

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) return
    setId('')
    setTarget('')
    setExtra('')
  }
  const handleTransportChange = (value: unknown[]) => {
    const [next] = value
    if (isTransport(next)) setTransport(next)
  }
  const handleSubmit = () => {
    if (!canSave) return
    onAdd({ id, transport, target: target.trim() })
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        Add MCP server
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an MCP server</DialogTitle>
          <DialogDescription>
            Every thread in this project connects to it. Use a server&apos;s existing ID to override
            it.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="mcp-id">ID</FieldLabel>
          <Input
            id="mcp-id"
            className="font-mono"
            placeholder="playwright"
            autoComplete="off"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel id="mcp-transport-label">Transport</FieldLabel>
          <ToggleGroup
            aria-labelledby="mcp-transport-label"
            variant="outline"
            spacing={0}
            value={[transport]}
            onValueChange={handleTransportChange}
          >
            <ToggleGroupItem value={EMcpTransport.Stdio} className="px-3">
              Command (stdio)
            </ToggleGroupItem>
            <ToggleGroupItem value={EMcpTransport.Http} className="px-3">
              Remote (HTTP)
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="mcp-target">{isStdio ? 'Command' : 'URL'}</FieldLabel>
          <Input
            id="mcp-target"
            className="font-mono"
            placeholder={isStdio ? 'bunx @playwright/mcp@latest' : 'https://mcp.example.com/mcp'}
            autoComplete="off"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <FieldDescription>
            {isStdio
              ? 'Runs inside the sandbox, so the binary must be installed by the setup script.'
              : 'Atlas signs in with OAuth when the server asks for it.'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="mcp-extra">{isStdio ? 'Environment' : 'Headers'}</FieldLabel>
          <Textarea
            id="mcp-extra"
            className="min-h-20 font-mono text-xs md:text-xs"
            spellCheck={false}
            placeholder={isStdio ? 'DEBUG=mcp:*' : 'Authorization: Bearer $LINEAR_TOKEN'}
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
          />
          <FieldDescription>
            One per line. <span className="font-mono">$NAME</span> reads from this project&apos;s
            secrets.
          </FieldDescription>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={!canSave} onClick={handleSubmit}>
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
