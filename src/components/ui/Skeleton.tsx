/**
 * Placeholders shaped like the content they stand in for, so the layout doesn't
 * jump when real data lands. Paired with `<Reveal>` the swap becomes a handoff
 * rather than a pop.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`shimmer rounded-field bg-base-300/40 ${className}`}
      aria-hidden="true"
    />
  );
}

export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className="h-5"
              // Uneven widths read as text; equal blocks read as a loading bar.
              {...{ style: { width: `${[22, 30, 16, 14, 18][c % 5]}%` } }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCalendar() {
  return (
    <div className="grid grid-cols-7 gap-px" aria-hidden="true">
      {Array.from({ length: 35 }, (_, i) => (
        <div key={i} className="day-cell rounded-field border border-base-300/40 p-1.5">
          <Skeleton className="mb-2 h-3 w-5" />
          {i % 3 !== 0 && <Skeleton className="h-12 w-full" />}
        </div>
      ))}
    </div>
  );
}
