import type { SVGProps } from "react";

export function AtlasMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="currentColor"
      role="img"
      aria-label="Atlas"
      {...props}
    >
      <path d="M88 372 245 132q10-14 20 0l66 104-48 31-28-43-103 156q-4 5-12 5H96q-14 0-8-13Z" />
      <path d="M345 247 415 366q7 19-10 19h-43q-8 0-12-7l-60-98Z" />
    </svg>
  );
}
