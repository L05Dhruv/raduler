"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toast: (tone: ToastTone, message: string) => void;
  /** Runs `fn`, reporting the outcome. Returns whether it succeeded. */
  run: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-success/40 text-success",
  error: "border-error/40 text-error",
  info: "border-info/40 text-info",
};

const TONE_ICONS: Record<ToastTone, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      // Errors linger: they usually explain a rule the user has to act on.
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3500);
    },
    [dismiss],
  );

  /**
   * Most mutations in this app share one shape: call the database, show what it
   * said, refresh. The error text is worth surfacing verbatim — it comes from the
   * RPC's own RAISE, so it names the actual rule that refused.
   */
  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      try {
        await fn();
        if (success) toast("success", success);
        return true;
      } catch (e) {
        toast("error", e instanceof Error ? e.message : "That did not go through.");
        return false;
      }
    },
    [toast],
  );

  const value = useMemo(() => ({ toast, run }), [toast, run]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map(({ id, tone, message }) => {
          const Icon = TONE_ICONS[tone];
          return (
            <div
              key={id}
              // assertive for errors so a screen reader interrupts; polite
              // otherwise, since a success message can wait its turn.
              role={tone === "error" ? "alert" : "status"}
              aria-live={tone === "error" ? "assertive" : "polite"}
              className={`toast-enter surface glass pointer-events-auto flex max-w-sm items-start gap-2.5 px-3.5 py-2.5 ${TONE_STYLES[tone]}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="text-sm text-base-content">{message}</p>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square -mr-1 -mt-0.5 shrink-0"
                aria-label="Dismiss"
                onClick={() => dismiss(id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
