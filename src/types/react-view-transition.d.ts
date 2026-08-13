import "react";

/**
 * `ViewTransition` ships in the React canary that Next bundles for the App Router,
 * but `@types/react` does not declare it yet. The runtime export is real —
 * `next/dist/compiled/react` exports it — so this only fills the typing gap.
 */
declare module "react" {
  /**
   * A class name to apply to the transition, `"auto"`, `"none"`, or a map from
   * transition type (as passed via `<Link transitionTypes>`) to class name.
   */
  type ViewTransitionClass = "auto" | "none" | (string & {}) | Record<string, string>;

  interface ViewTransitionProps {
    children?: ReactNode;
    /** Shared identity: matching names on either side of a navigation morph. */
    name?: string;
    default?: ViewTransitionClass;
    enter?: ViewTransitionClass;
    exit?: ViewTransitionClass;
    share?: ViewTransitionClass;
    update?: ViewTransitionClass;
    onEnter?: (element: Element, types: string[]) => void;
    onExit?: (element: Element, types: string[]) => void;
    onShare?: (element: Element, types: string[]) => void;
    onUpdate?: (element: Element, types: string[]) => void;
  }

  export const ViewTransition: ComponentType<ViewTransitionProps>;
}
