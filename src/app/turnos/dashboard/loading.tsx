function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/5 ${className}`} />;
}

export default function TurnosDashboardLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <Block className="h-12" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Block className="h-24" />
        <Block className="h-24" />
      </div>
      <Block className="h-96" />
    </div>
  );
}
