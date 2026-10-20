import { useState } from "react";
import { PlusIcon, SearchIcon, SparklesIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@dltech/atlas-ui/components/input-group";

import {
  BUILT_IN_SKILLS,
  ESkillSource,
  INSTALLED_SKILLS,
  type LibrarySkill,
} from "../../../fixtures/settings-library";
import { LibraryConfirmDialog } from "../parts/library-confirm-dialog";
import { LibraryInstallDialog } from "../parts/library-install-dialog";
import { SkillRow } from "../parts/library-skill-row";
import { Mono, SettingsCard, SettingsPage, SettingsSection } from "../settings-layout";

function matches({ skill, query }: { skill: LibrarySkill; query: string }) {
  const needle = query.trim().toLowerCase();
  return (
    needle.length === 0 ||
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle)
  );
}

export function SkillsPage({ initial = INSTALLED_SKILLS }: { initial?: LibrarySkill[] }) {
  const [installed, setInstalled] = useState(initial);
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<LibrarySkill | null>(null);

  const handleInstall = (source: string) => {
    const name = source.includes("/")
      ? (source.split("/").pop() ?? "skill").replace(/\.git$/, "")
      : "custom-skill";
    setInstalled((current) => [
      {
        id: `new-${name}`,
        name,
        description: "Installed just now from the pasted source.",
        source: ESkillSource.User,
        enabled: true,
      },
      ...current,
    ]);
  };

  const handleToggle = ({ id, enabled }: { id: string; enabled: boolean }) =>
    setInstalled((current) =>
      current.map((skill) => (skill.id === id ? { ...skill, enabled } : skill)),
    );

  const handleRemove = () => {
    setInstalled((current) => current.filter((skill) => skill.id !== removing?.id));
    setRemoving(null);
  };

  const visibleInstalled = installed.filter((skill) => matches({ skill, query }));
  const visibleBuiltIn = BUILT_IN_SKILLS.filter((skill) => matches({ skill, query }));

  return (
    <SettingsPage
      title="Skills"
      description={
        <>
          Packaged <Mono>SKILL.md</Mono> instructions the agent loads when a task calls for them.
        </>
      }
      actions={
        <>
          <InputGroup className="w-48">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search skills…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          <LibraryInstallDialog
            triggerLabel="Install skill"
            triggerIcon={<PlusIcon />}
            title="Install skill"
            description="Paste a git URL, or paste the contents of a SKILL.md."
            label="Git URL or SKILL.md"
            placeholder="https://github.com/dltech/skills/tree/main/ui-design"
            multiline
            submitLabel="Install"
            onSubmit={handleInstall}
          />
        </>
      }
    >
      <SettingsSection
        title="Installed"
        description="Skills you or your projects added. Disabled skills are never loaded."
      >
        {visibleInstalled.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>No installed skills{query ? " match your search" : " yet"}.</EmptyTitle>
              <EmptyDescription>
                Install a skill from a git URL to teach the agent a repeatable workflow.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SettingsCard>
            {visibleInstalled.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                onToggle={(enabled) => handleToggle({ id: skill.id, enabled })}
                actions={[
                  { label: "View SKILL.md", onSelect: () => undefined },
                  { label: "Remove", onSelect: () => setRemoving(skill), destructive: true },
                ]}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      {visibleBuiltIn.length > 0 ? (
        <SettingsSection title="Built-in" description="Ship with Atlas. Read-only.">
          <SettingsCard>
            {visibleBuiltIn.map((skill) => (
              <SkillRow key={skill.id} skill={skill} />
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <LibraryConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={`Remove ${removing?.name ?? "skill"}?`}
        description="The skill is removed from your library. You can install it again at any time."
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </SettingsPage>
  );
}
