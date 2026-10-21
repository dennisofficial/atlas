import { useState } from "react";
import { toast } from "sonner";
import { FolderSearchIcon, LinkIcon, PlusIcon } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@dltech/atlas-ui/components/breadcrumb";
import { Button } from "@dltech/atlas-ui/components/button";
import { Toaster } from "@dltech/atlas-ui/components/sonner";

import { NewProjectDialog } from "./new-project-dialog";
import type { NewProjectSeed } from "./new-project-types";
import { OwnerList } from "./owner-list";
import { ProjectRow } from "./project-row";
import { filterProjects, PROJECT_OWNERS, PROJECTS, type ProjectSummary } from "./projects.fixtures";

export interface ProjectsViewProps {
  initialOwnerId?: string | null;
  newProject?: NewProjectSeed;
}

function ProjectsHeader({ ownerName, onNewProject }: { ownerName: string; onNewProject: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#projects">Projects</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{ownerName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Copy link to this view">
          <LinkIcon />
        </Button>
        <Button onClick={onNewProject}>
          <PlusIcon data-icon="inline-start" />
          New project
        </Button>
      </div>
    </header>
  );
}

function EmptyResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <FolderSearchIcon className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">No projects found</p>
      <p className="text-xs text-muted-foreground">
        {query.trim() ? `Nothing matches “${query.trim()}”.` : "This owner has no projects yet."}
      </p>
    </div>
  );
}

export function ProjectsView({ initialOwnerId = null, newProject }: ProjectsViewProps) {
  const [ownerId, setOwnerId] = useState<string | null>(initialOwnerId);
  const [query, setQuery] = useState("");
  const [allProjects, setAllProjects] = useState(PROJECTS);
  const [dialogOpen, setDialogOpen] = useState(newProject !== undefined);
  const owner = PROJECT_OWNERS.find((candidate) => candidate.id === ownerId);
  const projects = filterProjects({ projects: allProjects, ownerId, query });

  const handleNewProject = () => setDialogOpen(true);
  const handleCreate = (project: ProjectSummary) => {
    setAllProjects((current) => [project, ...current]);
    setOwnerId(project.owner);
    setQuery("");
    setDialogOpen(false);
    toast.success("Project created", { description: `${project.owner}/${project.name}` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectsHeader ownerName={owner?.name ?? "All projects"} onNewProject={handleNewProject} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] items-start gap-8 px-6 py-8">
          <OwnerList
            owners={PROJECT_OWNERS}
            selectedId={ownerId}
            query={query}
            onQueryChange={setQuery}
            onSelect={setOwnerId}
          />
          <div className="min-w-0 flex-1">
            {projects.length === 0 ? (
              <EmptyResults query={query} />
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {projects.map((project) => (
                  <ProjectRow key={project.id} project={project} showOwner={ownerId === null} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={allProjects}
        defaultOwnerId={ownerId}
        seed={newProject}
        onCreate={handleCreate}
      />
      <Toaster />
    </div>
  );
}
