import type { ReactNode } from 'react'

import { RadioGroup } from '@dltech/atlas-ui/components/radio-group'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { CONTEXT_FIELDS, EXPERIMENTAL_FIELDS, QUALITY_FIELDS } from '../fixtures/settings-fields'
import { EFFORT_STEPS, ROLE_ORDER, ROLE_META } from '../fixtures/settings-agent'
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

export function ModelsSkeleton() {
  return (
    <>
      <SettingsSection
        title="Presets"
        description="Set the main agent, subagents and background calls at once. Editing a role switches this to Custom."
      >
        <Skeleton className="h-7 w-56 rounded-lg" />
      </SettingsSection>
      {ROLE_ORDER.map((role) => (
        <SettingsSection
          key={role}
          title={ROLE_META[role].title}
          description={ROLE_META[role].description}
        >
          <SettingsCard>
            <SettingsRowSkeleton control={ERowControl.Select} lines={2} />
            {ROLE_META[role].hasEffort ? (
              <SettingsRowSkeleton
                control={ERowControl.None}
                custom={<Skeleton className="h-4 w-12" />}
                extra={
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-full" />
                    <div className="flex h-4 items-center justify-between">
                      {EFFORT_STEPS.map((step) => (
                        <Skeleton key={step.effort} className="h-3 w-8" />
                      ))}
                    </div>
                  </div>
                }
              />
            ) : null}
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
