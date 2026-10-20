import { Button } from "#components/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "#components/hover-card";
import { hostnameOf, type Source } from "./sources";

export interface InlineCitationProps extends Source {
  excerpt?: string;
}

export function InlineCitation({ url, title, excerpt }: InlineCitationProps) {
  const hostname = hostnameOf(url);

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={<Button variant="secondary" size="xs" className="align-baseline" />}
      >
        {hostname}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-1">
        <div className="font-medium">{title ?? hostname}</div>
        {excerpt ? (
          <p className="text-xs text-muted-foreground">{excerpt}</p>
        ) : null}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
        >
          {hostname}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </HoverCardContent>
    </HoverCard>
  );
}
