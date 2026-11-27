'use client'

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
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { mcpDraftIsValid, serverIdOf, transportKindOf } from '@dltech/atlas-client/settings'

import { EMcpTransport } from '../fixtures/settings-mcp'
import type { McpDraft } from './mcp-store'

const TRANSPORT_ITEMS = [
  { value: EMcpTransport.Stdio, label: 'stdio' },
  { value: EMcpTransport.Http, label: 'http' },
]

type Draft = {
  name: string
  transport: EMcpTransport
  target: string
  extra: string
  proxy: boolean
}

const EMPTY_DRAFT: Draft = {
  name: '',
  transport: EMcpTransport.Stdio,
  target: '',
  extra: '',
  proxy: false,
}

export function McpAddDialog({ onAdd }: { onAdd: (draft: McpDraft) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const isStdio = draft.transport === EMcpTransport.Stdio
  const valid = mcpDraftIsValid({
    id: serverIdOf(draft.name),
    kind: transportKindOf(draft.transport),
    target: draft.target,
    extra: draft.extra,
    proxy: draft.proxy,
  })

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(EMPTY_DRAFT)
    setOpen(next)
  }

  const handleTransportChange = (value: EMcpTransport | null) => {
    if (value) setDraft({ ...draft, transport: value })
  }

  const handleAdd = () => {
    onAdd({
      id: serverIdOf(draft.name),
      transport: draft.transport,
      target: draft.target.trim(),
      enabled: true,
      extra: draft.extra,
      proxy: draft.proxy,
    })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        Add MCP Server
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            Atlas starts the server when a thread needs it and lists its tools to the model.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              placeholder="filesystem"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-transport">Transport</Label>
            <Select
              items={TRANSPORT_ITEMS}
              value={draft.transport}
              onValueChange={handleTransportChange}
            >
              <SelectTrigger id="mcp-transport" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORT_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-target">{isStdio ? 'Command' : 'URL'}</Label>
            <Input
              id="mcp-target"
              className="font-mono text-xs"
              placeholder={
                isStdio
                  ? 'npx -y @modelcontextprotocol/server-everything'
                  : 'https://mcp.example.com/mcp'
              }
              value={draft.target}
              onChange={(event) => setDraft({ ...draft, target: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-extra">{isStdio ? 'Environment' : 'Headers'}</Label>
            <Textarea
              id="mcp-extra"
              rows={3}
              className="font-mono text-xs"
              placeholder={isStdio ? 'API_KEY=…' : 'Authorization: Bearer …'}
              value={draft.extra}
              onChange={(event) => setDraft({ ...draft, extra: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {isStdio ? 'One KEY=value per line.' : 'One Header: value per line.'}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="mcp-proxy">Run on my Mac</Label>
            <Switch
              id="mcp-proxy"
              checked={draft.proxy}
              onCheckedChange={(proxy) => setDraft({ ...draft, proxy })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The Mac app starts this server on your Mac instead of in the sandbox.
          </p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose>
          <Button size="sm" disabled={!valid} onClick={handleAdd}>
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
