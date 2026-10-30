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

import { useDesktopUpdate } from './use-desktop-update'

export function updateLine(version: string | undefined): string {
  return version === undefined
    ? 'A new version of Atlas is ready'
    : `Atlas ${version} is ready to install`
}

export function UpdateCard() {
  const update = useDesktopUpdate()
  if (!update.ready || update.dismissed) return null
  return (
    <Card size="sm" aria-label="Update ready" role="region">
      <CardHeader>
        <CardTitle>Update ready</CardTitle>
        <CardDescription>{updateLine(update.version)}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={update.dismiss}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Button size="sm" className="w-full" disabled={update.restarting} onClick={update.restart}>
          {update.restarting ? 'Restarting…' : 'Restart to update'}
        </Button>
      </CardContent>
    </Card>
  )
}
