function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/5 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <Block className="h-56" />
      <Block className="h-24" />
      <Block className="h-24" />
      <Block className="h-64" />
      <Block className="h-40" />
    </div>
  );
}
