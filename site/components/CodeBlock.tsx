import { ReactNode } from "react";

export function CodeBlock({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <pre className={`real-code ${className}`}>{children}</pre>;
}
