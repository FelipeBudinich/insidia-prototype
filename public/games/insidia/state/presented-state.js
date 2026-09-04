// Only an accepted personalized projection can be an endpoint. Transient props
// belong to the director; this class never computes rules or invents a hand.
export class PresentedState {
  constructor() {
    this.endpoint = null;
    this.revision = 0n;
    this.frozen = false;
  }
  reconcile(projection, { frozen = false } = {}) {
    if (!projection) {
      this.endpoint = null;
      this.revision = 0n;
      this.frozen = frozen;
      return;
    }
    const revision = BigInt(projection.projectionRevision ?? 0);
    if (
      this.endpoint?.roomId === projection.roomId &&
      this.endpoint?.projectionEpoch === projection.projectionEpoch &&
      revision < this.revision
    ) return;
    this.endpoint = projection;
    this.revision = revision;
    this.frozen = frozen;
  }
}

export function publicOnlyProjection(projection) {
  if (!projection) return null;
  return {
    ...projection,
    self: {
      playerId: projection.self?.playerId,
      hand: [],
      legalActions: [],
      prompt: null,
      privateEffects: [],
    },
  };
}
