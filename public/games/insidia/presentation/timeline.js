import { MOTION, monotonicNow } from "./motion-tokens.js";

export class Timeline {
  constructor(now = monotonicNow) {
    this.now = now;
    this.tracks = [];
  }
  get backlogMs() {
    return Math.max(0, ...this.tracks.map((track) => track.endsAt - this.now()));
  }
  schedule(cues, { reduced = false, compact = false } = {}) {
    const now = this.now();
    const priorEnds = new Map();
    const origin = compact ? now : now + this.backlogMs;
    const planned = cues.map((cue) => {
      const durationMs = reduced ? MOTION.reduced : cue.durationMs;
      const start = Math.max(origin, ...cue.after.map((id) => priorEnds.get(id) ?? origin));
      const beat = reduced ? 35 : Math.min(cue.beatMs ?? durationMs, durationMs);
      priorEnds.set(cue.id, start + beat);
      return { ...cue, startedAt: start, durationMs, endsAt: start + durationMs };
    });
    const span = Math.max(0, ...planned.map((track) => track.endsAt - origin));
    // A live decision always renders authority. Its outcome props can overlap
    // in a compact lane; they never postpone those controls.
    const available = compact ? 800 : Math.max(120, MOTION.backlog - this.backlogMs);
    const factor = span > available ? available / span : 1;
    for (const track of planned) {
      track.startedAt = origin + (track.startedAt - origin) * factor;
      track.durationMs *= factor;
      track.endsAt = track.startedAt + track.durationMs;
      this.tracks.push(Object.freeze(track));
    }
    // Overflow is reconciled by the director before scheduling; this is a
    // final allocation guard, never an unbounded pool of per-turn sprites.
    this.tracks = this.tracks.slice(-MOTION.maxSprites);
  }
  sample() {
    const now = this.now();
    return this.tracks.filter((track) => now >= track.startedAt && now < track.endsAt)
      .map((track) => ({
        ...track,
        progress: Math.max(0, Math.min(1, (now - track.startedAt) / track.durationMs)),
      }));
  }
  update() {
    const now = this.now();
    this.tracks = this.tracks.filter((track) => track.endsAt > now);
  }
  finish() {
    const count = this.tracks.length;
    this.tracks = [];
    return count;
  }
  cancel() { return this.finish(); }
}
