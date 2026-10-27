type Guard = () => Promise<boolean>;
let guard: Guard | undefined;
let isPending: (() => boolean) | undefined;

export function registerPendingChangesGuard(next: Guard, pending: () => boolean = () => true): () => void {
  guard = next;
  isPending = pending;
  return () => { if (guard === next) { guard = undefined; isPending = undefined; } };
}

export function hasPendingChanges(): boolean { return isPending?.() ?? false; }

export function confirmPendingChanges(): Promise<boolean> {
  return guard?.() ?? Promise.resolve(true);
}
