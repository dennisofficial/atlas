'use client'

import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { initialsOf } from './session/initials'
import { useSessionUser, useWorkspaceName } from './session/use-session-identity'
import { ESettingsScope } from './settings-nav'

export function WorkspaceLogo({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-primary text-[10px] font-semibold text-primary-foreground ${className ?? ''}`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function ScopeTabs({
  scope,
  onScopeChange,
}: {
  scope: ESettingsScope
  onScopeChange: (scope: ESettingsScope) => void
}) {
  const { user } = useSessionUser()
  const workspaceName = useWorkspaceName()
  const initials = initialsOf(user?.name ?? '')
  return (
    <Tabs
      className="min-w-0 md:justify-self-center"
      value={scope}
      onValueChange={(value) => onScopeChange(value as ESettingsScope)}
    >
      <TabsList className="max-w-full">
        <TabsTrigger value={ESettingsScope.Personal}>
          <Avatar size="xs">
            {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          Personal
        </TabsTrigger>
        <TabsTrigger value={ESettingsScope.Workspace} className="min-w-0">
          <WorkspaceLogo name={workspaceName} />
          <span className="max-w-24 truncate sm:max-w-48">{workspaceName}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

export function SettingsTopBar({
  scope,
  onScopeChange,
}: {
  scope: ESettingsScope
  onScopeChange: (scope: ESettingsScope) => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:grid md:grid-cols-[1fr_auto_1fr]">
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground md:justify-self-start"
        nativeButton={false}
        render={<Link href="/" />}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        <span className="sr-only sm:not-sr-only">Back to Atlas</span>
      </Button>
      <ScopeTabs scope={scope} onScopeChange={onScopeChange} />
      <span className="hidden md:block" />
    </header>
  )
}
