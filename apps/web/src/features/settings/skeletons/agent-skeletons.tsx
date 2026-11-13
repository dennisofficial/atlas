import type { ReactNode } from 'react'

import { RadioGroup } from '@dltech/atlas-ui/components/radio-group'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { roleKey } from '@dltech/atlas-core'
import { CardRow } from '@dltech/atlas-ui/components/card'

import { CONTEXT_FIELDS, EXPERIMENTAL_FIELDS, QUALITY_FIELDS } from '../fixtures/settings-fields'
import { ROLE_GROUPS } from '../parts/models/role-groups'
import { SettingsCard, SettingsSection } from '../settings-layout'
import { SettingFieldRowsSkeleton } from './field-rows'
import { NotifyMatrixSkeleton } from './table-skeletons'
import {
  ConfigFooterSkeleton,
  ERowControl,
  RowCardSkeleton,
  SaveFooterSkeleton,
  SettingsRowSkeleton,
} from './primitives'

export function AgentSkeleton() {
  return (
    <>
      <SettingsSection
        title="Decisions"
        description="Typed decisions answer the yes-or-no questions behind the tool-call judge, skill suggestion and code-quality review."
      >
        <RowCardSkeleton controls={[ERowControl.Select, ERowControl.Key]} lines={2} />
      </SettingsSection>
      <SettingsSection
        title="Nudges"
        description="A cheaper model looks at a call that trips a deterministic probe and decides whether to interrupt you."
      >
        <RowCardSkeleton controls={[ERowControl.Select]} lines={3} />
      </SettingsSection>
      <SettingsSection title="Web search" description="Which service the web_search tool asks.">
        <RowCardSkeleton controls={[ERowControl.Select]} lines={2} />
      </SettingsSection>
      <SettingsSection
        title="Context and skills"
        description="What the agent reads before each turn, when it compacts, and where it works."
      >
        <SettingsCard>
          <SettingFieldRowsSkeleton fields={CONTEXT_FIELDS} />
        </SettingsCard>
      </SettingsSection>
      <ConfigFooterSkeleton />
    </>
  )
}

function FieldsEditorSkeleton({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <>
      <SettingsSection title={title} description={description}>
        <SettingsCard>{children}</SettingsCard>
      </SettingsSection>
      <ConfigFooterSkeleton />
    </>
  )
}

export function ExperimentalSkeleton() {
  return (
    <FieldsEditorSkeleton
      title="Planning and pull requests"
      description="Opt-in planning and CI behavior."
    >
      <SettingFieldRowsSkeleton fields={EXPERIMENTAL_FIELDS} />
    </FieldsEditorSkeleton>
  )
}

export function QualitySkeleton() {
  return (
    <FieldsEditorSkeleton
      title="Review"
      description="Turn the review on, then choose which policies it applies."
    >
      <SettingFieldRowsSkeleton fields={QUALITY_FIELDS} />
      <SettingsRowSkeleton control={ERowControl.Switch} lines={2} />
    </FieldsEditorSkeleton>
  )
}

export function AppearanceSkeleton() {
  return (
    <>
      <SettingsSection title="Theme" description="Choose the palette used across the app.">
        <RadioGroup className="grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="flex flex-col gap-2 rounded-lg border p-2.5">
              <Skeleton className="mb-0 h-24 w-full" />
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </RadioGroup>
      </SettingsSection>
      <SettingsSection title="Display" description="Tune density and how code and motion render.">
        <RowCardSkeleton
          controls={[
            ERowControl.Toggles,
            ERowControl.ShortSelect,
            ERowControl.Switch,
            ERowControl.Switch,
          ]}
          footer={<SaveFooterSkeleton />}
        />
      </SettingsSection>
    </>
  )
}

function RoleRowSkeleton() {
  return (
    <CardRow>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-7 w-48 rounded-lg" />
      </div>
    </CardRow>
  )
}

export function ModelsSkeleton() {
  return (
    <>
      {ROLE_GROUPS.map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          <SettingsCard size="sm">
            {group.roles.map((role) => (
              <RoleRowSkeleton key={roleKey(role)} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ))}
      <ConfigFooterSkeleton />
    </>
  )
}

export function NotificationsSkeleton() {
  return (
    <>
      <SettingsSection title="Channels" description="Where notifications can be delivered.">
        <RowCardSkeleton controls={[ERowControl.Switch, ERowControl.Switch]} />
      </SettingsSection>
      <SettingsSection title="Notify me when" description="Pick a delivery channel for each event.">
        <SettingsCard footer={<SaveFooterSkeleton />}>
          <NotifyMatrixSkeleton />
          <SettingsRowSkeleton
            control={ERowControl.None}
            custom={
              <>
                <Skeleton className="h-[18px] w-8 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-lg" />
                <Skeleton className="h-3 w-4" />
                <Skeleton className="h-7 w-24 rounded-lg" />
              </>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
