import { ArrowUpRightIcon, GlobeIcon } from "lucide-react";

import { Trace } from "#components/trace";
import { Step, StepLink } from "./internal/step";

export interface Source {
  url: string;
  title?: string;
}

export interface SourcesProps {
  sources: Source[];
  defaultOpen?: boolean;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function dedupeSources(sources: Source[]): Source[] {
  return sources.filter(
    (source, index) =>
      sources.findIndex((other) => other.url === source.url) === index,
  );
}

export function Sources({ sources, defaultOpen }: SourcesProps) {
  const unique = dedupeSources(sources);
  if (unique.length === 0) return null;

  return (
    <Trace>
      <Step
        icon={<GlobeIcon />}
        title={`Used ${unique.length} ${unique.length === 1 ? "source" : "sources"}`}
        defaultOpen={defaultOpen}
      >
        <Trace>
          {unique.map((source) => (
            <StepLink
              key={source.url}
              href={source.url}
              icon={<GlobeIcon />}
              title={
                <>
                  {source.title ?? hostnameOf(source.url)}
                  <span className="sr-only"> (opens in a new tab)</span>
                </>
              }
              trailing={<ArrowUpRightIcon />}
            />
          ))}
        </Trace>
      </Step>
    </Trace>
  );
}
