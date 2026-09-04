export const MOTION = Object.freeze({
  feedback: 100,
  cardLift: 160,
  hoverDwell: 250,
  inspector: 160,
  panel: 200,
  travel: 360,
  dealStagger: 70,
  impact: 150,
  claim: 240,
  pass: 150,
  proof: 300,
  exposure: 850,
  conspiracyEntrance: 350,
  conspiracyHold: 1500,
  result: 1500,
  reduced: 120,
  backlog: 1000,
  overload: 2000,
  maxSprites: 24,
  maxHistory: 200,
});

export const EASING = Object.freeze({
  arrival: [0.16, 1, 0.3, 1],
  departure: [0.4, 0, 1, 1],
  travel: [0.4, 0, 0.2, 1],
});

export const monotonicNow = () => performance.now();

// A server clock sample never drives a cosmetic timeline. Between validated
// samples this clock progresses on performance.now(), including after an OS
// wall-clock correction. Small corrections settle without counting backwards.
export class ServerClock {
  constructor(now = monotonicNow, wallNow = Date.now) {
    this.monotonic = now;
    this.wallNow = wallNow;
    this.anchorAt = now();
    this.anchorValue = wallNow();
    this.correction = 0;
    this.correctionMs = 0;
    this.sampled = false;
  }
  now() {
    const elapsed = Math.max(0, this.monotonic() - this.anchorAt);
    const fraction = this.correctionMs
      ? Math.min(1, elapsed / this.correctionMs)
      : 1;
    return this.anchorValue + elapsed + this.correction * fraction;
  }
  sample(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return false;
    const current = this.now();
    const delta = parsed - current;
    this.anchorAt = this.monotonic();
    if (!this.sampled || Math.abs(delta) > 1000) {
      this.anchorValue = parsed;
      this.correction = 0;
      this.correctionMs = 0;
    } else {
      this.anchorValue = current;
      this.correction = delta;
      this.correctionMs = Math.max(500, Math.abs(delta) * 2);
    }
    this.sampled = true;
    return true;
  }
}
