import { MOTION, monotonicNow } from "./motion-tokens.js";
import { Timeline } from "./timeline.js";
import { effectSequence, localDecisionKey, planEffects, sanitizePublicEffect } from "./effect-planner.js";
import { PresentedState, publicOnlyProjection } from "../state/presented-state.js";
import { PresentationMetrics } from "./metrics.js";

const PREFERENCE_KEY = "insidia.motion";

export class PresentationDirector {
  constructor({ now = monotonicNow, storage, matchMedia } = {}) {
    this.now = now;
    this.timeline = new Timeline(now);
    this.presentedState = new PresentedState();
    this.authority = null;
    this.history = [];
    this.historyIncomplete = false;
    this.watermark = 0n;
    this.scope = null;
    this.needsSeed = true;
    this.hidden = false;
    this.frozen = false;
    this.revealStates = [];
    this.batches = [];
    this.notice = null;
    this.noticeUntil = 0;
    this.decisionKey = null;
    this.decisionReadySince = null;
    this.claimContext = null;
    this.timingMetrics = new PresentationMetrics();
    this.metrics = { acceptedSnapshots: 0, plannedCues: 0, canceledCues: 0, reconciliations: 0, historyGaps: 0, presentationBacklogMs: 0 };
    try { this.storage = storage ?? globalThis.localStorage; } catch { this.storage = null; }
    let preference;
    try { preference = this.storage?.getItem(PREFERENCE_KEY); } catch { /* Storage can be unavailable in private mode. */ }
    this.motionPreference = ["system", "full", "reduced"].includes(preference) ? preference : "system";
    this.media = (matchMedia ?? globalThis.matchMedia)?.call(globalThis, "(prefers-reduced-motion: reduce)");
    this.motionChanged = () => {
      if (this.motionPreference === "system") this.finishCosmetics();
    };
    this.media?.addEventListener?.("change", this.motionChanged);
  }
  get reducedMotion() {
    return this.motionPreference === "reduced" || (this.motionPreference === "system" && !!this.media?.matches);
  }
  get cues() { return this.hidden || this.frozen ? [] : this.timeline.sample(); }
  get diagnostics() { return { ...this.metrics, ...this.timingMetrics.summary() }; }
  recordMetric(name, durationMs) { this.timingMetrics.record(name, durationMs); }
  markDecisionReady() {
    if (this.hidden || this.frozen) { this.decisionReadySince = null; return; }
    if (this.decisionReadySince !== null) {
      this.recordMetric("projectionToDecisionReadyMs", this.now() - this.decisionReadySince);
      this.decisionReadySince = null;
    }
  }
  markRevealsReady() {
    if (this.hidden || this.frozen) return;
    const now = this.now();
    this.revealStates = this.revealStates.map((reveal) => reveal.firstPresentedAt !== null ? reveal : {
      ...reveal,
      firstPresentedAt: now,
      readableAt: Math.max(reveal.readableAt, now),
      expiresAt: Math.max(reveal.expiresAt, now + MOTION.conspiracyHold),
    });
  }
  get reveals() {
    if (this.hidden) return [];
    const now = this.now();
    return this.revealStates.map((reveal) => ({
      ...reveal,
      progress: reveal.readableAt <= reveal.enteredAt ? 1 : Math.max(0, Math.min(1, (now - reveal.enteredAt) / (reveal.readableAt - reveal.enteredAt))),
    }));
  }
  setMotionPreference(value) {
    if (!["system", "full", "reduced"].includes(value)) return;
    this.motionPreference = value;
    try { this.storage?.setItem(PREFERENCE_KEY, value); } catch { /* Preference still applies for this session. */ }
    this.finishCosmetics();
  }
  finishCosmetics() {
    this.metrics.canceledCues += this.timeline.finish();
    this.batches = [];
    const now = this.now();
    // Existing readable holds survive a preference change, while their
    // entrance motion finishes safely at the current authoritative endpoint.
    this.revealStates = this.revealStates.map((reveal) => ({
      ...reveal, enteredAt: now, readableAt: Math.min(now, reveal.readableAt),
    }));
    this.presentedState.reconcile(this.authority, { frozen: this.frozen });
  }
  remember(effects, projection, observed = false) {
    for (const effect of effects) {
      this.history.push(Object.freeze({
        ...effect,
        ...(observed && effect.stateVersion === projection.stateVersion
          ? { turnNumber: projection.public.turn?.turnNumber }
          : { groupLabel: "Actividad reciente" }),
      }));
    }
    if (this.history.length > MOTION.maxHistory) this.historyIncomplete = true;
    this.history = this.history.slice(-MOTION.maxHistory);
  }
  signalUpdate() {
    this.notice = "Mesa actualizada";
    this.noticeUntil = this.now() + 1800;
    this.metrics.reconciliations++;
  }
  seed(projection, effects) {
    this.history = [];
    this.historyIncomplete = !!effects.length && effectSequence(effects[0]) > 1n;
    this.remember(effects, projection);
    this.revealStates = [];
    this.installReveals(projection, [], true);
    this.needsSeed = false;
    this.decisionKey = localDecisionKey(projection);
    if (this.decisionKey) this.decisionReadySince = this.now();
    this.updateClaimContext(projection, null, [], true);
  }
  updateClaimContext(projection, previous, unseen = [], currentOnly = false) {
    const pub = projection.public;
    if (pub.room.status !== "active" || pub.turn?.phase === "awaitingTurnAction") {
      this.claimContext = null;
      return;
    }
    const interaction = pub.interaction;
    if (interaction?.declaredSin) {
      this.claimContext = Object.freeze({
        sin: interaction.declaredSin,
        actorPlayerId: interaction.actorPlayerId,
        turnNumber: pub.turn?.turnNumber,
        source: "current",
      });
      return;
    }
    const sameTurn = !currentOnly && previous?.roomId === projection.roomId &&
      previous.projectionEpoch === projection.projectionEpoch &&
      previous.public.turn?.turnNumber === pub.turn?.turnNumber;
    if (!sameTurn) { this.claimContext = null; return; }
    const declaration = unseen.filter((effect) => effect.kind === "sinDeclared").at(-1);
    if (declaration) this.claimContext = Object.freeze({
      sin: declaration.sin,
      actorPlayerId: declaration.actorPlayerId,
      effectSeq: declaration.effectSeq,
      turnNumber: pub.turn?.turnNumber,
      source: "observed",
    });
    // A same-turn public declaration remains the parent of nested Vanidad
    // resolution even when the current prompt has no declaredSin field.
    // Reconnect/history-gap resets may only use an explicit current claim.
  }
  ingest(projection, previous = this.authority) {
    this.metrics.acceptedSnapshots++;
    const scope = `${projection.roomId}:${projection.projectionEpoch}`;
    if (scope !== this.scope) {
      this.reset({ clearHistory: true });
      this.scope = scope;
    }
    this.authority = projection;
    this.frozen = false;
    // Values, own hand and decision context are always current. Semantic
    // trails explain public outcomes without delaying legal information.
    this.presentedState.reconcile(projection);
    const effects = [...(projection.public.recentEffects ?? [])]
      .map(sanitizePublicEffect).filter(Boolean)
      .sort((left, right) => {
        const a = effectSequence(left), b = effectSequence(right);
        return a < b ? -1 : a > b ? 1 : 0;
      }).filter((effect, index, values) => index === 0 || effectSequence(effect) !== effectSequence(values[index - 1]));
    if (projection.public.room.status === "faulted") {
      this.reset({ clearHistory: true });
      this.scope = scope;
      this.authority = publicOnlyProjection(projection);
      this.presentedState.reconcile(this.authority, { frozen: true });
      return;
    }
    if (this.needsSeed) {
      this.watermark = effects.length ? effectSequence(effects.at(-1)) : 0n;
      this.seed(projection, effects);
      if (projection.public.result?.endReason === "abandoned") {
        this.authority = publicOnlyProjection(projection);
        this.revealStates = [];
        this.frozen = true;
        this.presentedState.reconcile(this.authority, { frozen: true });
      }
      return;
    }
    const unseen = effects.filter((effect) => effectSequence(effect) > this.watermark);
    const gap = unseen.some((effect, index) => effectSequence(effect) >
      (index ? effectSequence(unseen[index - 1]) : this.watermark) + 1n);
    if (effects.length) this.watermark = this.watermark > effectSequence(effects.at(-1)) ? this.watermark : effectSequence(effects.at(-1));
    this.remember(unseen, projection, !!previous?.public.turn &&
      previous.public.turn.turnNumber === projection.public.turn?.turnNumber);
    this.updateClaimContext(projection, previous, unseen, gap);
    const decision = localDecisionKey(projection);
    const newDecision = decision !== null && decision !== this.decisionKey;
    this.decisionKey = decision;
    if (newDecision) this.decisionReadySince = this.now();
    else if (!decision) this.decisionReadySince = null;
    if (projection.public.result?.endReason === "abandoned") {
      this.authority = publicOnlyProjection(projection);
      this.finishCosmetics();
      this.revealStates = [];
      this.frozen = true;
      this.presentedState.reconcile(this.authority, { frozen: true });
      return;
    }
    if (this.hidden || gap) {
      if (gap) {
        this.metrics.historyGaps++;
        this.historyIncomplete = true;
      }
      this.finishCosmetics();
      this.revealStates = [];
      if (!this.hidden) this.installReveals(projection, [], true);
      this.signalUpdate();
      return;
    }
    this.installReveals(projection, unseen);
    if (newDecision) this.finishCosmetics();
    let cues = planEffects(previous, projection, unseen);
    const queuedMs = this.timeline.backlogMs + cues.reduce((total, cue) => total + cue.beatMs, 0);
    if (queuedMs > MOTION.overload || this.timeline.tracks.length + cues.length > MOTION.maxSprites) {
      this.finishCosmetics();
      this.signalUpdate();
      return;
    }
    if (queuedMs > MOTION.backlog) {
      this.finishCosmetics();
      // Repeated routine trails/passes can collapse; distinct proof, exposure
      // and reveal facts remain in the ordered public history.
      const routine = new Set();
      cues = cues.filter((cue) => {
        if (!["transferSouls", "advanceDecision"].includes(cue.kind)) return true;
        const key = `${cue.kind}:${cue.effect.actorPlayerId}`;
        if (routine.has(key)) return false;
        routine.add(key);
        return true;
      });
    }
    if (cues.length) {
      const deadline = Date.parse(projection.self?.prompt?.deadline ?? projection.public.interaction?.deadline ?? projection.public.turn?.deadline);
      const urgent = Number.isFinite(deadline) && Number.isFinite(projection.serverTime && Date.parse(projection.serverTime)) && deadline - Date.parse(projection.serverTime) <= 5000;
      const batch = Object.freeze({
        roomId: projection.roomId,
        projectionEpoch: projection.projectionEpoch,
        revision: projection.projectionRevision,
        stateVersion: projection.stateVersion,
        endpoint: projection,
        cues: Object.freeze([...cues]),
      });
      this.batches.push(batch);
      this.batches = this.batches.slice(-MOTION.maxSprites);
      this.timeline.schedule(cues, { reduced: this.reducedMotion || urgent, compact: newDecision });
      this.metrics.plannedCues += cues.length;
    }
    this.metrics.presentationBacklogMs = this.timeline.backlogMs;
  }
  installReveals(projection, effects, immediate = false) {
    const now = this.now();
    const active = projection.public.board?.revealedConspiracy?.conspiracy;
    const allEffects = projection.public.recentEffects ?? [];
    const latestActive = allEffects.filter((effect) => effect.kind === "conspiracyRevealed" && effect.conspiracy === active)
      .sort((a, b) => effectSequence(a) < effectSequence(b) ? -1 : 1).at(-1);
    const activeKey = active ? latestActive?.effectSeq ?? `active:${projection.projectionRevision}` : null;
    this.revealStates = this.revealStates.filter((reveal) => reveal.firstPresentedAt === null || reveal.expiresAt > now || reveal.key === activeKey)
      .map((reveal) => ({ ...reveal, current: reveal.key === activeKey }));
    const incoming = effects.filter((effect) => effect.kind === "conspiracyRevealed");
    if (active && !this.revealStates.some((reveal) => reveal.key === activeKey) && !incoming.some((effect) => effect.effectSeq === activeKey)) {
      incoming.push({ effectSeq: activeKey, conspiracy: active });
    }
    for (const effect of incoming) {
      if (this.revealStates.some((reveal) => reveal.key === effect.effectSeq)) continue;
      const readableAt = immediate || this.reducedMotion ? now : now + MOTION.conspiracyEntrance;
      this.revealStates.push({
        id: `${projection.roomId}:${projection.projectionEpoch}:reveal:${effect.effectSeq}`,
        key: effect.effectSeq,
        effectSeq: effect.effectSeq,
        conspiracy: effect.conspiracy,
        card: Object.freeze({ conspiracy: effect.conspiracy }),
        current: effect.effectSeq === activeKey,
        enteredAt: now, readableAt, expiresAt: readableAt + MOTION.conspiracyHold,
        firstPresentedAt: null,
      });
    }
    if (this.revealStates.length > 2) {
      const current = this.revealStates.find((reveal) => reveal.current);
      this.revealStates = this.revealStates.filter((reveal) => reveal !== current).slice(current ? -1 : -2);
      if (current) this.revealStates.push(current);
      this.signalUpdate();
    }
  }
  update() {
    this.timeline.update();
    const now = this.now();
    this.revealStates = this.revealStates.filter((reveal) => reveal.firstPresentedAt === null || reveal.current || reveal.expiresAt > now);
    if (!this.timeline.tracks.length) {
      this.batches = [];
      this.presentedState.reconcile(this.authority, { frozen: this.frozen });
    }
    if (this.notice && now >= this.noticeUntil) this.notice = null;
    this.metrics.presentationBacklogMs = this.timeline.backlogMs;
  }
  setHidden(hidden) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.finishCosmetics();
    this.revealStates = [];
    if (!hidden && this.authority) {
      this.installReveals(this.authority, [], true);
      this.signalUpdate();
    }
  }
  disconnect({ superseded = false } = {}) {
    const publicView = publicOnlyProjection(this.authority);
    this.reset({ clearHistory: superseded });
    this.authority = superseded ? null : publicView;
    this.frozen = true;
    this.presentedState.reconcile(this.authority, { frozen: true });
  }
  reset({ clearHistory = true } = {}) {
    this.metrics.canceledCues += this.timeline.cancel();
    this.batches = [];
    this.authority = null;
    this.revealStates = [];
    this.scope = null;
    this.watermark = 0n;
    this.needsSeed = true;
    this.decisionKey = null;
    this.decisionReadySince = null;
    this.claimContext = null;
    this.notice = null;
    if (clearHistory) { this.history = []; this.historyIncomplete = false; }
    this.presentedState.reconcile(null);
  }
  destroy() {
    this.reset();
    this.media?.removeEventListener?.("change", this.motionChanged);
  }
}
