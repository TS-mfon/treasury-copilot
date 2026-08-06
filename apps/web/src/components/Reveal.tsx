export function Reveal({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={`reveal ${className}`}>{children}</div>;
}
