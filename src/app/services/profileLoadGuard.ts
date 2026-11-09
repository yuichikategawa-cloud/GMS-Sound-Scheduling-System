export interface ProfileLoadGuard {
  begin(): number;
  isCurrent(requestId: number): boolean;
  invalidate(): void;
}

/** Invalidates stale profile reads when the authenticated identity changes. */
export function createProfileLoadGuard(): ProfileLoadGuard {
  let sequence = 0;
  return {
    begin: () => ++sequence,
    isCurrent: requestId => requestId === sequence,
    invalidate: () => { sequence += 1; },
  };
}
