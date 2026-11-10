'use client'

import { XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@dltech/atlas-ui/components/card'

import { webBuild } from '@/lib/build-info'

import { EDesktopUpdateKind, useDesktopUpdate } from './use-desktop-update'

export interface IUpdateCopy {
  title: string
  line: string
  action: string
  busy: string
}

export function updateCopy({
  kind,
  version,
  running,
}: {
  kind: EDesktopUpdateKind
  version: string | undefined
  running: string | undefined
}): IUpdateCopy {
  const shown = kind === EDesktopUpdateKind.Interface && version === running ? undefined : version
  const line =
    shown === undefined
      ? kind === EDesktopUpdateKind.Interface
        ? 'A newer build is ready to install'
        : 'A new version of Atlas is ready'
      : `Atlas ${shown} is ready to install`
  if (kind === EDesktopUpdateKind.Interface)
    return { title: 'New interface ready', line, action: 'Reload', busy: 'Reloading…' }
  return { title: 'Update ready', line, action: 'Restart to update', busy: 'Restarting…' }
}

export function UpdateCard() {
  const update = useDesktopUpdate()
  if (!update.ready || update.kind === undefined || update.dismissed) return null
  const copy = updateCopy({
    kind: update.kind,
    version: update.version,
    running: webBuild().version,
  })
  return (
    <Card size="sm" aria-label={copy.title} role="region">
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.line}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={update.dismiss}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {update.error === undefined ? null : (
          <p role="alert" className="text-sm text-destructive">
            {update.error}
          </p>
        )}
        <Button size="sm" className="w-full" disabled={update.restarting} onClick={update.restart}>
          {update.restarting ? copy.busy : copy.action}
        </Button>
      </CardContent>
    </Card>
  )
}
