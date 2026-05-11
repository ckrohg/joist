export function StatusPill({
  badge = "STATUS",
  children,
}: {
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="status-line">
      <span className="badge">{badge}</span>
      {children}
    </div>
  );
}
