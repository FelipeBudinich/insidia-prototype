import { micros } from "../domain/model.js";
// UTC values come from PostgreSQL; elapsed time comes from the monotonic process clock.
export class TrustedClock {
  private anchor = 0n;
  private monotonic = 0n;
  private last = 0n;
  anchorTo(instant: string) {
    this.anchor = micros(instant);
    this.monotonic = process.hrtime.bigint();
    this.last = this.anchor;
  }
  now = () => {
    if (!this.monotonic) throw new Error("Clock is not anchored");
    const candidate =
      this.anchor + (process.hrtime.bigint() - this.monotonic) / 1000n;
    this.last = candidate > this.last ? candidate : this.last;
    const ms = this.last / 1000n,
      sub = this.last % 1000n;
    return new Date(Number(ms))
      .toISOString()
      .replace(/Z$/, String(sub).padStart(3, "0") + "Z");
  };
  check(databaseTime: string) {
    const drift = micros(this.now()) - micros(databaseTime);
    if (drift > 250000n || drift < -250000n)
      throw new Error("Trusted clock drift exceeded 250 ms");
  }
}
