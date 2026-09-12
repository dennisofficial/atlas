import { useEffect, useState } from "react";

import { cn } from "../lib/cn";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);

  return (
    <span aria-hidden className={cn("font-mono leading-none", className)}>
      {FRAMES[frame]}
    </span>
  );
}
