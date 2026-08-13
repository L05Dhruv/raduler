import type { LucideIcon } from "lucide-react";

/**
 * An empty table row saying "no results" tells the user nothing about what to do
 * next. This says what would fill the space and how to get there.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-base-300/50 text-base-content/50">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        {hint && (
          <p className="mt-1 max-w-sm text-sm text-base-content/60">{hint}</p>
        )}
      </div>
      {action}
    </div>
  );
}
