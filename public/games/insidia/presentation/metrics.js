const NAMES = new Set([
  "inputToFeedbackMs", "projectionToDecisionReadyMs", "frameIntervalMs", "frameSubmissionMs",
]);

// Local diagnostics only. Windows hold durations, never event timestamps,
// commands, card identities, decision contents or sealed submission state.
export class PresentationMetrics {
  constructor(capacity = 240) {
    this.capacity = capacity;
    this.windows = new Map();
  }
  record(name, value) {
    if (!NAMES.has(name) || !Number.isFinite(value) || value < 0) return;
    let entry = this.windows.get(name);
    if (!entry) this.windows.set(name, entry = { samples: [], count: 0, total: 0, max: 0 });
    entry.samples.push(value);
    if (entry.samples.length > this.capacity) entry.samples.shift();
    entry.count++;
    entry.total += value;
    entry.max = Math.max(entry.max, value);
  }
  summary() {
    const result = {};
    for (const [name, entry] of this.windows) {
      const sorted = [...entry.samples].sort((a, b) => a - b);
      const percentile = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
      result[name] = {
        count: entry.count,
        mean: entry.total / entry.count,
        max: entry.max,
        p95: percentile(0.95),
        p99: percentile(0.99),
        windowSize: sorted.length,
      };
    }
    return result;
  }
}
