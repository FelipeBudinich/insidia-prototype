import {
  SINS,
  CONSPIRACIES,
  COSTS,
  type Sin,
  type Command,
} from "../../shared/protocol/schema.js";
import {
  type Room,
  type Seat,
  type Game,
  type Frame,
  type Pending,
  type Environment,
  type Sealed,
  defaults,
  active,
  seat,
  plus,
  before,
  demand,
  IntegrityError,
} from "./model.js";

export function shuffle<T>(values: T[], env: Environment): T[] {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = env.integer(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const choose = <T>(a: T[], env: Environment) => {
  if (!a.length) throw new IntegrityError("SIN_CAPACITY");
  return a.length === 1 ? a[0] : a[env.integer(a.length)];
};
const remove = (a: string[], id: string) => {
  const n = a.indexOf(id);
  if (n < 0) throw new IntegrityError("CARD_LOCATION_BIJECTION");
  a.splice(n, 1);
  return id;
};
const g = (r: Room) => r.game!;
const actor = (r: Room) => r.seats[g(r).activeSeatIndex];
const frame = (r: Room) => g(r).stack.at(-1)!;
export function effect(r: Room, kind: string, data: Record<string, any> = {}) {
  const v = g(r);
  v.effects.push({
    effectSeq: String(v.nextEffectSeq++),
    stateVersion: r.stateVersion + 1,
    kind,
    ...data,
  });
  if (v.effects.length > 60) v.effects.splice(0, v.effects.length - 60);
}
function moveHidden(r: Room, id: string) {
  const c = g(r).cards[id];
  c.epoch++;
  delete c.reason;
  delete c.exposedTurnNumber;
}
function draw(r: Room, to: Seat, count: number) {
  if (g(r).sinDeck.length < count) throw new IntegrityError("SIN_CAPACITY");
  for (let i = 0; i < count; i++) {
    const id = g(r).sinDeck.shift()!;
    moveHidden(r, id);
    to.hand.push(id);
  }
}
function pay(r: Room, p: Seat, n: number) {
  demand(p.souls >= n, "INSUFFICIENT_SOULS");
  p.souls -= n;
  g(r).bank += n;
  if (n) effect(r, "soulsPaid", { actorPlayerId: p.playerId, amount: n });
}
function gain(r: Room, p: Seat, n: number) {
  const amount = Math.min(n, g(r).bank);
  p.souls += amount;
  g(r).bank -= amount;
  effect(r, "soulsGained", { actorPlayerId: p.playerId, amount });
}
function expose(r: Room, p: Seat, id: string, reason: string) {
  remove(p.hand, id);
  const c = g(r).cards[id];
  c.epoch++;
  c.reason = reason;
  c.exposedTurnNumber = g(r).turnNumber;
  p.faceUpSins.push(id);
  effect(r, "sinExposed", {
    actorPlayerId: p.playerId,
    sin: c.definition,
    reason,
  });
}
function randomExpose(r: Room, p: Seat, reason: string, env: Environment) {
  if (p.hand.length) expose(r, p, choose(p.hand, env), reason);
}
const clockwise = (r: Room, p: Seat) =>
  Array.from(
    { length: r.seats.length - 1 },
    (_, i) => r.seats[(p.seatIndex + i + 1) % r.seats.length],
  ).filter((s) => s.status === "active");
function openTurn(r: Room, env: Environment) {
  g(r).phase = {
    kind: "awaitingTurnAction",
    actorId: actor(r).playerId,
    opportunityId: env.id(),
    deadline: plus(env.now(), g(r).configuration.timersMs.turnAction),
  };
  delete g(r).pending;
  g(r).stack = [];
}
export function finish(
  r: Room,
  reason: Game["endReason"],
  env: Environment,
  winner?: string,
) {
  r.status = "finished";
  g(r).endReason = reason;
  if (winner) g(r).winnerPlayerId = winner;
  else delete g(r).winnerPlayerId;
  g(r).phase = { kind: "finished" };
  delete r.allHumansDisconnected;
  r.memberFacingExpiry = {
    timerId: env.id(),
    deadline: plus(env.now(), r.lifecyclePolicy.memberFacingRetentionMs),
  };
  effect(r, "gameFinished", {
    reason,
    ...(winner ? { winnerPlayerId: winner } : {}),
  });
}
export function abandon(r: Room, env: Environment) {
  g(r).abandonedFromPhase = structuredClone(g(r).phase);
  finish(r, "abandoned", env);
}
export function startGame(r: Room, env: Environment, configuration = defaults) {
  demand(r.status === "lobby", "INVALID_PHASE");
  demand(r.seats.length === r.config.totalPlayers, "INVALID_ROOM_CONFIG");
  demand(
    r.seats.filter((p) => p.kind === "human").every((p) => p.ready),
    "NOT_READY",
  );
  const conf = structuredClone(configuration);
  demand(
    conf.manifest.totalSins === 24 &&
      conf.manifest.sinCopies === 3 &&
      conf.manifest.totalSouls === 60,
    "RULESET_ERROR",
  );
  r.seats.sort((a, b) =>
    a.kind === b.kind
      ? a.joinedOrdinal - b.joinedOrdinal
      : a.kind === "human"
        ? -1
        : 1,
  );
  r.seats.forEach((s, i) => {
    s.seatIndex = i;
    s.hand = [];
    s.faceUpSins = [];
    s.souls = 2;
    s.status = "active";
  });
  const cards: Game["cards"] = {};
  const sins: string[] = [];
  const cons: string[] = [];
  for (const definition of SINS)
    for (let i = 0; i < 3; i++) {
      const id = env.id();
      cards[id] = { id, family: "sin", definition, epoch: 0 };
      sins.push(id);
    }
  for (const definition of CONSPIRACIES) {
    const id = env.id();
    cards[id] = { id, family: "conspiracy", definition, epoch: 0 };
    cons.push(id);
  }
  r.game = {
    gameId: env.id(),
    rulesetId: conf.rulesetId,
    configuration: conf,
    configurationHash: env.hash(conf),
    cards,
    sinDeck: shuffle(sins, env),
    conspiracyDeck: shuffle(cons, env),
    publicCenter: [],
    bank: 60 - 2 * r.seats.length,
    activeSeatIndex: env.integer(r.seats.length),
    turnNumber: 1,
    phase: { kind: "finished" },
    stack: [],
    effects: [],
    nextEffectSeq: 1,
  };
  for (let round = 0; round < 2; round++)
    for (const p of r.seats) draw(r, p, 1);
  r.status = "active";
  if (r.privateCode) {
    delete r.privateCode;
    r.privateCodeGeneration++;
  }
  delete r.hostSuccession;
  delete r.emptyLobbyExpiry;
  effect(r, "gameStarted");
  openTurn(r, env);
  validateRoom(r, env);
}
function returnHeld(r: Room, env: Environment) {
  if (g(r).resolvingSin) {
    const id = g(r).resolvingSin!;
    moveHidden(r, id);
    g(r).sinDeck.push(id);
    g(r).sinDeck = shuffle(g(r).sinDeck, env);
    delete g(r).resolvingSin;
  }
}
export function cleanup(r: Room, env: Environment) {
  const v = g(r),
    old = actor(r),
    eliminated = active(r).filter((s) => s.faceUpSins.length >= 2),
    survivors = active(r).filter((s) => s.faceUpSins.length < 2);
  const demandCount =
    survivors.length > 1
      ? survivors.reduce((n, s) => n + Math.max(0, 2 - s.hand.length), 0)
      : 0;
  if (
    v.sinDeck.length + eliminated.reduce((n, p) => n + p.hand.length, 0) <
    demandCount
  )
    throw new IntegrityError("SIN_CAPACITY");
  let returned = false;
  for (const p of eliminated) {
    p.status = "eliminated";
    for (const id of p.faceUpSins)
      v.publicCenter.push({ cardId: id, formerOwnerId: p.playerId });
    p.faceUpSins = [];
    for (const id of p.hand) {
      moveHidden(r, id);
      v.sinDeck.push(id);
      returned = true;
    }
    p.hand = [];
    v.bank += p.souls;
    p.souls = 0;
    effect(r, "playerEliminated", { actorPlayerId: p.playerId });
  }
  if (returned) v.sinDeck = shuffle(v.sinDeck, env);
  v.stack = [];
  delete v.pending;
  if (survivors.length <= 1) {
    finish(
      r,
      survivors.length ? "last_survivor" : "draw",
      env,
      survivors[0]?.playerId,
    );
    return;
  }
  const order = [old, ...clockwise(r, old)].filter(
    (p) => p.status === "active",
  );
  for (const p of order) draw(r, p, Math.max(0, 2 - p.hand.length));
  v.activeSeatIndex = clockwise(r, old)[0].seatIndex;
  v.turnNumber++;
  openTurn(r, env);
}
function complete(r: Room, env: Environment) {
  const v = g(r);
  if (frame(r)?.kind === "conspiracy") {
    const id = v.revealedConspiracy!;
    moveHidden(r, id);
    v.conspiracyDeck.push(id);
    v.conspiracyDeck = shuffle(v.conspiracyDeck, env);
    delete v.revealedConspiracy;
    v.stack.pop();
  }
  returnHeld(r, env);
  v.stack = [];
  delete v.pending;
  cleanup(r, env);
}
function prompt(
  r: Room,
  owner: Seat,
  kind: string,
  answerKind: string,
  options: string[],
  env: Environment,
  count = 1,
  ordered = false,
) {
  if (options.length < count) throw new IntegrityError("SIN_CAPACITY");
  const p: Pending = {
    kind,
    ownerId: owner.playerId,
    answerKind,
    options,
    count,
    ordered,
  };
  g(r).pending = p;
  frame(r).stage = kind;
  if (options.length === 1 && count === 1) {
    resolvePrompt(r, options[0], env);
    return;
  }
  g(r).phase = {
    kind: "awaitingPrompt",
    playerId: owner.playerId,
    promptId: env.id(),
    deadline: plus(
      env.now(),
      kind === "indigenciaChoice"
        ? g(r).configuration.timersMs.indigenciaChoice
        : g(r).configuration.timersMs.ordinaryPrompt,
    ),
  };
}
function counters(r: Room, cost: number, env: Environment) {
  const f = frame(r),
    p = seat(r, f.actorId),
    responders = clockwise(r, p)
      .filter((s) => s.souls >= cost)
      .map((s) => s.playerId);
  g(r).pending = {
    kind: "counter",
    actorId: p.playerId,
    responders,
    passed: [],
    index: 0,
    cost,
    targetId: f.targetId,
  };
  f.stage = "counter";
  if (!responders.length) {
    unblocked(r, env);
    return;
  }
  g(r).phase = {
    kind: "awaitingCounter",
    interactionId: env.id(),
    responderId: responders[0],
    deadline: plus(env.now(), g(r).configuration.timersMs.counterResponse),
  };
}
function unblocked(r: Room, env: Environment) {
  const f = frame(r);
  if (f.effect === "ORGULLO") {
    returnHeld(r, env);
    g(r).stack = [];
    delete g(r).pending;
    finish(r, "orgullo", env, f.actorId);
  } else if (f.effect === "RABIA") {
    const p = seat(r, f.targetId!);
    prompt(r, p, "rabiaExposeCard", "selectCard", [...p.hand], env);
  } else {
    for (const p of active(r)) {
      for (const id of p.hand) {
        moveHidden(r, id);
        g(r).sinDeck.push(id);
      }
      p.hand = [];
    }
    g(r).sinDeck = shuffle(g(r).sinDeck, env);
    effect(r, "handsShuffled");
    complete(r, env);
  }
}
function sinEffect(r: Room, sin: Sin, env: Environment) {
  const p = actor(r);
  pay(r, p, COSTS[sin]);
  g(r).stack = [
    {
      kind: "sin",
      frameId: env.id(),
      actorId: p.playerId,
      effect: sin,
      stage: "resolve",
      ...(g(r).resolvingSin ? { heldOutSinId: g(r).resolvingSin } : {}),
    },
  ];
  delete g(r).pending;
  switch (sin) {
    case "ORGULLO":
      counters(r, 8, env);
      break;
    case "RABIA":
      prompt(
        r,
        p,
        "rabiaTarget",
        "selectPlayer",
        clockwise(r, p)
          .filter((s) => s.hand.length)
          .map((s) => s.playerId),
        env,
      );
      break;
    case "GULA":
      gain(r, p, 3);
      complete(r, env);
      break;
    case "ENVIDIA":
      draw(r, p, 2);
      prompt(
        r,
        p,
        "envidiaBottomOrder",
        "selectCards",
        [...p.hand],
        env,
        2,
        true,
      );
      break;
    case "AVARICIA":
      prompt(
        r,
        p,
        "avariciaTarget",
        "selectPlayer",
        clockwise(r, p).map((s) => s.playerId),
        env,
      );
      break;
    case "VANIDAD":
      conspiracy(r, "vanidad", env);
      break;
    case "LUJURIA":
      prompt(
        r,
        p,
        "lujuriaTarget",
        "selectPlayer",
        clockwise(r, p)
          .filter((s) => s.hand.length)
          .map((s) => s.playerId),
        env,
      );
      break;
    case "PEREZA":
      counters(r, 2, env);
      break;
  }
}
function conspiracy(r: Room, source: "conspire" | "vanidad", env: Environment) {
  const v = g(r),
    p = actor(r),
    id = v.conspiracyDeck.shift();
  if (!id) throw new IntegrityError("CARD_MANIFEST");
  v.revealedConspiracy = id;
  v.cards[id].epoch++;
  const definition = v.cards[id].definition;
  v.stack.push({
    kind: "conspiracy",
    frameId: env.id(),
    actorId: p.playerId,
    effect: definition,
    stage: "resolve",
    source,
    conspiracyCardId: id,
  });
  effect(r, "conspiracyRevealed", {
    actorPlayerId: p.playerId,
    conspiracy: definition,
  });
  switch (definition) {
    case "SUPREMACIA": {
      const n = Math.min(...active(r).map((s) => s.souls));
      prompt(
        r,
        p,
        "supremaciaTieTarget",
        "selectPlayer",
        active(r)
          .filter((s) => s.souls === n)
          .map((s) => s.playerId),
        env,
      );
      break;
    }
    case "AGONIA": {
      const n = Math.max(...active(r).map((s) => s.souls));
      prompt(
        r,
        p,
        "agoniaTieTarget",
        "selectPlayer",
        active(r)
          .filter((s) => s.souls === n)
          .map((s) => s.playerId),
        env,
      );
      break;
    }
    case "INDIGENCIA":
      prompt(
        r,
        p,
        "indigenciaChoice",
        "selectPayment",
        p.souls >= 3 ? ["pay", "discard"] : ["discard"],
        env,
      );
      break;
    case "HEREJIA":
      prompt(
        r,
        p,
        "herejiaDirection",
        "selectDirection",
        ["left", "right"],
        env,
      );
      break;
    case "PERFIDIA":
      if (p.faceUpSins.length) {
        const id = p.faceUpSins.shift()!;
        moveHidden(r, id);
        v.sinDeck.push(id);
        v.sinDeck = shuffle(v.sinDeck, env);
        effect(r, "sinForgiven", { actorPlayerId: p.playerId });
      } else gain(r, p, 2);
      complete(r, env);
      break;
    case "APOSTASIA":
      prompt(r, p, "apostasiaCard", "selectCard", [...p.hand], env);
      break;
  }
}
function transferCard(r: Room, from: Seat, to: Seat, id: string) {
  remove(from.hand, id);
  moveHidden(r, id);
  to.hand.push(id);
  effect(r, "cardTransferred", {
    actorPlayerId: from.playerId,
    targetPlayerId: to.playerId,
  });
}
function resolvePrompt(r: Room, answer: string | string[], env: Environment) {
  const pending = g(r).pending!,
    f = frame(r),
    p = seat(r, f.actorId),
    one = answer as string;
  switch (pending.kind) {
    case "rabiaTarget":
      f.targetId = one;
      effect(r, "targetSelected", {
        actorPlayerId: p.playerId,
        targetPlayerId: one,
      });
      counters(r, 3, env);
      return;
    case "rabiaExposeCard":
      expose(r, seat(r, f.targetId!), one, "rabia");
      break;
    case "envidiaBottomOrder":
      for (const id of answer as string[]) {
        remove(p.hand, id);
        moveHidden(r, id);
        g(r).sinDeck.push(id);
      }
      effect(r, "cardsExchanged", { actorPlayerId: p.playerId, amount: 2 });
      break;
    case "avariciaTarget": {
      const target = seat(r, one),
        n = Math.min(2, target.souls);
      target.souls -= n;
      p.souls += n;
      effect(r, "soulsStolen", {
        actorPlayerId: p.playerId,
        targetPlayerId: one,
        amount: n,
      });
      break;
    }
    case "lujuriaTarget":
      f.targetId = one;
      effect(r, "targetSelected", {
        actorPlayerId: p.playerId,
        targetPlayerId: one,
      });
      prompt(
        r,
        seat(r, one),
        "lujuriaGiveCard",
        "selectCard",
        [...seat(r, one).hand],
        env,
      );
      return;
    case "lujuriaGiveCard":
      transferCard(r, seat(r, f.targetId!), p, one);
      f.receivedCardId = one;
      prompt(r, p, "lujuriaReturnCard", "selectCard", [...p.hand], env);
      return;
    case "lujuriaReturnCard":
      transferCard(r, p, seat(r, f.targetId!), one);
      break;
    case "supremaciaTieTarget":
      gain(r, seat(r, one), 3);
      break;
    case "agoniaTieTarget": {
      const target = seat(r, one);
      pay(r, target, Math.min(3, target.souls));
      break;
    }
    case "indigenciaChoice":
      if (one === "pay") pay(r, p, 3);
      else randomExpose(r, p, "indigencia", env);
      break;
    case "herejiaDirection": {
      const participants = active(r).map((p) => p.playerId);
      g(r).pending = {
        kind: "herejiaCards",
        actorId: p.playerId,
        direction: one as "left" | "right",
        participants,
      };
      f.stage = "herejiaCards";
      g(r).phase = {
        kind: "awaitingSimultaneousCards",
        promptId: env.id(),
        deadline: plus(env.now(), g(r).configuration.timersMs.ordinaryPrompt),
      };
      if (participants.every((id) => seat(r, id).hand.length === 1)) {
        rotate(
          r,
          Object.fromEntries(
            participants.map((id) => [id, seat(r, id).hand[0]]),
          ),
          env,
        );
      }
      return;
    }
    case "apostasiaCard":
      remove(p.hand, one);
      moveHidden(r, one);
      g(r).sinDeck.push(one);
      draw(r, p, 1);
      effect(r, "cardsExchanged", { actorPlayerId: p.playerId, amount: 1 });
      break;
    default:
      throw new IntegrityError("PHASE_CONTINUATION");
  }
  complete(r, env);
}
export function rotate(
  r: Room,
  selections: Record<string, string>,
  env: Environment,
) {
  const p = g(r).pending!;
  const players = active(r),
    outgoing = players.map((s) => ({
      p: s,
      id: selections[s.playerId],
      index: s.hand.indexOf(selections[s.playerId]),
    }));
  if (outgoing.some((o) => o.index < 0))
    throw new IntegrityError("SEALED_HEREJIA");
  const step = p.direction === "right" ? 1 : -1;
  for (let i = 0; i < outgoing.length; i++) {
    const from = outgoing[i],
      to = outgoing[(i + step + outgoing.length) % outgoing.length];
    moveHidden(r, from.id);
    to.p.hand[to.index] = from.id;
  }
  effect(r, "cardsRotated", { direction: p.direction });
  complete(r, env);
}
export function gameCommand(
  r: Room,
  playerId: string,
  cmd: Command,
  env: Environment,
  receivedAt: string,
  sealed: Sealed[] = [],
): { sealed?: Sealed } {
  demand(r.status !== "faulted", "MATCH_FAULTED");
  demand(r.status === "active", "INVALID_PHASE");
  validateRoom(r, env);
  const v = g(r),
    phase = v.phase,
    p = seat(r, playerId),
    data = cmd.payload;
  const herejia =
    cmd.type === "game.answerPrompt" &&
    data.answer.kind === "selectHerejiaCard";
  if (cmd.type === "game.answerPrompt")
    demand(
      (phase.kind === "awaitingPrompt" ||
        phase.kind === "awaitingSimultaneousCards") &&
        phase.promptId === data.promptId &&
        herejia === (phase.kind === "awaitingSimultaneousCards"),
      "INVALID_PHASE",
    );
  else if (["game.challenge", "game.passChallenge"].includes(cmd.type))
    demand(
      phase.kind === "awaitingChallenge" &&
        phase.interactionId === data.interactionId,
      "INVALID_PHASE",
    );
  else if (["game.payCounter", "game.passCounter"].includes(cmd.type))
    demand(
      phase.kind === "awaitingCounter" &&
        phase.interactionId === data.interactionId,
      "INVALID_PHASE",
    );
  else
    demand(
      phase.kind === "awaitingTurnAction" &&
        phase.opportunityId === data.opportunityId,
      "INVALID_PHASE",
    );
  if (!herejia)
    demand(cmd.expectedStateVersion === r.stateVersion, "STALE_STATE");
  if (phase.kind === "awaitingTurnAction")
    demand(phase.actorId === playerId, "NOT_YOUR_TURN");
  if (phase.kind === "awaitingChallenge" || phase.kind === "awaitingCounter")
    demand(phase.responderId === playerId, "NOT_CURRENT_RESPONDER");
  if (phase.kind === "awaitingPrompt")
    demand(phase.playerId === playerId, "NOT_CURRENT_RESPONDER");
  demand(before(receivedAt, phase.deadline), "DEADLINE_EXPIRED");
  if (herejia) {
    demand(
      v.pending!.participants!.includes(playerId) &&
        p.hand.length > 1 &&
        !sealed.some((s) => s.playerId === playerId),
      "INVALID_PHASE",
    );
    const id = p.hand.find(
      (id) => env.handRef(r, p, v.cards[id]) === data.answer.handCardRef,
    );
    demand(id, "CARD_NOT_OWNED");
    return {
      sealed: {
        roomId: r.roomId,
        promptId: data.promptId,
        playerId,
        cardId: id,
        epoch: v.cards[id].epoch,
        ordinal: "0",
      },
    };
  }
  switch (cmd.type) {
    case "game.takeSouls":
      gain(r, p, 2);
      cleanup(r, env);
      break;
    case "game.forceRandomDiscard": {
      const t = r.seats.find(
        (s) =>
          s.playerId === data.targetPlayerId &&
          s !== p &&
          s.status === "active" &&
          s.hand.length,
      );
      demand(t, "INVALID_TARGET");
      pay(r, p, 8);
      randomExpose(r, t, "forcedDiscard", env);
      cleanup(r, env);
      break;
    }
    case "game.conspire":
      pay(r, p, 1);
      conspiracy(r, "conspire", env);
      break;
    case "game.declareSin": {
      const sin = data.sin as Sin;
      demand(p.souls >= COSTS[sin], "INSUFFICIENT_SOULS");
      const ids = clockwise(r, p).map((p) => p.playerId);
      v.pending = {
        kind: "sinClaim",
        actorId: playerId,
        sin,
        responders: ids,
        passed: [],
        index: 0,
      };
      v.phase = {
        kind: "awaitingChallenge",
        interactionId: env.id(),
        responderId: ids[0],
        deadline: plus(env.now(), v.configuration.timersMs.challengeResponse),
      };
      effect(r, "sinDeclared", { actorPlayerId: playerId, sin });
      break;
    }
    case "game.passChallenge": {
      const q = v.pending!;
      effect(r, "challengePassed", { actorPlayerId: playerId });
      q.passed!.push(playerId);
      q.index = (q.index ?? 0) + 1;
      if (q.index === q.responders!.length) sinEffect(r, q.sin!, env);
      else
        v.phase = {
          kind: "awaitingChallenge",
          interactionId: env.id(),
          responderId: q.responders![q.index!],
          deadline: plus(env.now(), v.configuration.timersMs.challengeResponse),
        };
      break;
    }
    case "game.challenge": {
      const q = v.pending!,
        a = seat(r, q.actorId!),
        matches = a.hand.filter((id) => v.cards[id].definition === q.sin);
      effect(r, "claimChallenged", {
        actorPlayerId: playerId,
        targetPlayerId: a.playerId,
        sin: q.sin,
      });
      if (!matches.length) {
        randomExpose(r, a, "bluffExposed", env);
        cleanup(r, env);
      } else {
        const id = choose(matches, env);
        remove(a.hand, id);
        v.cards[id].epoch++;
        v.resolvingSin = id;
        effect(r, "claimProven", { actorPlayerId: a.playerId, sin: q.sin });
        randomExpose(r, p, "incorrectChallenge", env);
        sinEffect(r, q.sin!, env);
      }
      break;
    }
    case "game.payCounter":
      pay(r, p, v.pending!.cost!);
      effect(r, "sinCountered", {
        actorPlayerId: playerId,
        sin: frame(r).effect,
      });
      complete(r, env);
      break;
    case "game.passCounter": {
      const q = v.pending!;
      q.passed!.push(playerId);
      q.index = (q.index ?? 0) + 1;
      if (q.index === q.responders!.length) unblocked(r, env);
      else
        v.phase = {
          kind: "awaitingCounter",
          interactionId: env.id(),
          responderId: q.responders![q.index!],
          deadline: plus(env.now(), v.configuration.timersMs.counterResponse),
        };
      break;
    }
    case "game.answerPrompt": {
      const q = v.pending!,
        answer = data.answer;
      demand(answer.kind === q.answerKind, "INVALID_PHASE");
      let value: any;
      if (answer.kind === "selectCards") {
        value = answer.handCardRefs.map((ref: string) =>
          p.hand.find((id) => env.handRef(r, p, v.cards[id]) === ref),
        );
        demand(
          value.length === q.count &&
            new Set(value).size === q.count &&
            value.every((id: string) => q.options!.includes(id)),
          "CARD_NOT_OWNED",
        );
      } else if (answer.kind === "selectCard") {
        value = p.hand.find(
          (id) => env.handRef(r, p, v.cards[id]) === answer.handCardRef,
        );
        demand(value && q.options!.includes(value), "CARD_NOT_OWNED");
      } else {
        value = answer.playerId ?? answer.direction ?? answer.choice;
        demand(q.options!.includes(value), "INVALID_TARGET");
      }
      resolvePrompt(r, value, env);
      break;
    }
    default:
      demand(false, "INVALID_PHASE");
  }
  validateRoom(r, env);
  return {};
}
export function timeout(r: Room, env: Environment, sealed: Sealed[] = []) {
  const v = g(r),
    phase = v.phase;
  if (phase.kind === "finished") return;
  if (phase.kind === "awaitingSimultaneousCards") {
    const choices: Record<string, string> = {};
    for (const p of active(r))
      choices[p.playerId] =
        sealed.find((s) => s.playerId === p.playerId)?.cardId ??
        choose(p.hand, env);
    rotate(r, choices, env);
    return;
  }
  if (phase.kind === "awaitingPrompt") {
    const q = v.pending!;
    let value: string | string[];
    if (q.kind === "indigenciaChoice")
      value = q.options!.includes("pay") ? "pay" : "discard";
    else if (q.count === 2) {
      const first = choose(q.options!, env),
        second = choose(
          q.options!.filter((o) => o !== first),
          env,
        );
      value = [first, second];
    } else value = choose(q.options!, env);
    resolvePrompt(r, value, env);
    return;
  }
  const kind =
    phase.kind === "awaitingTurnAction"
      ? "game.takeSouls"
      : phase.kind === "awaitingChallenge"
        ? "game.passChallenge"
        : "game.passCounter";
  gameCommand(
    r,
    "actorId" in phase ? phase.actorId : phase.responderId,
    {
      kind: "command",
      protocolVersion: 1,
      type: kind,
      commandId: env.id(),
      roomId: r.roomId,
      expectedStateVersion: r.stateVersion,
      payload:
        "opportunityId" in phase
          ? { opportunityId: phase.opportunityId }
          : { interactionId: phase.interactionId },
    },
    env,
    plus(phase.deadline, -1),
  );
}
export function validateRoom(r: Room, env: Environment) {
  if (r.status === "closed") {
    if (r.seats.length || r.game) throw new IntegrityError("GAME_SHAPE");
    return;
  }
  if (r.status === "faulted") {
    if (r.game || !r.integrityFault) throw new IntegrityError("GAME_SHAPE");
    return;
  }
  if (r.status === "lobby") {
    if (r.game) throw new IntegrityError("GAME_SHAPE");
    return;
  }
  const v = r.game;
  if (
    !v ||
    r.seats.length < 3 ||
    r.seats.length > 6 ||
    !r.seats[v.activeSeatIndex] ||
    v.configurationHash !== env.hash(v.configuration)
  )
    throw new IntegrityError("GAME_SHAPE");
  if (
    r.seats.some(
      (p, i) =>
        p.seatIndex !== i || !Number.isSafeInteger(p.souls) || p.souls < 0,
    ) ||
    v.bank < 0 ||
    !Number.isSafeInteger(v.bank) ||
    v.bank + r.seats.reduce((n, p) => n + p.souls, 0) !== 60
  )
    throw new IntegrityError("SOUL_CONSERVATION");
  const ids = Object.keys(v.cards),
    seen = [
      ...v.sinDeck,
      ...v.conspiracyDeck,
      ...r.seats.flatMap((s) => [...s.hand, ...s.faceUpSins]),
      ...v.publicCenter.map((c) => c.cardId),
      ...(v.resolvingSin ? [v.resolvingSin] : []),
      ...(v.revealedConspiracy ? [v.revealedConspiracy] : []),
    ];
  if (
    ids.length !== 30 ||
    seen.length !== 30 ||
    new Set(seen).size !== 30 ||
    seen.some((id) => !v.cards[id]) ||
    ids.some(
      (id) =>
        v.cards[id].id !== id ||
        !Number.isSafeInteger(v.cards[id].epoch) ||
        v.cards[id].epoch < 0,
    )
  )
    throw new IntegrityError("CARD_LOCATION_BIJECTION");
  for (const sin of SINS)
    if (
      ids.filter(
        (id) => v.cards[id].definition === sin && v.cards[id].family === "sin",
      ).length !== 3
    )
      throw new IntegrityError("CARD_MANIFEST");
  for (const c of CONSPIRACIES)
    if (
      ids.filter(
        (id) =>
          v.cards[id].definition === c && v.cards[id].family === "conspiracy",
      ).length !== 1
    )
      throw new IntegrityError("CARD_MANIFEST");
  if (
    v.sinDeck.some((id) => v.cards[id].family !== "sin") ||
    v.conspiracyDeck.some((id) => v.cards[id].family !== "conspiracy") ||
    r.seats.some((p) =>
      [...p.hand, ...p.faceUpSins].some((id) => v.cards[id].family !== "sin"),
    )
  )
    throw new IntegrityError("CARD_MANIFEST");
  if (r.status === "active") {
    if (
      v.phase.kind === "finished" ||
      r.seats[v.activeSeatIndex].status !== "active"
    )
      throw new IntegrityError("PHASE_CONTINUATION");
    if (
      v.phase.kind === "awaitingTurnAction" &&
      (v.stack.length ||
        v.pending ||
        r.seats.some(
          (p) =>
            p.status === "active" &&
            (p.hand.length !== 2 || p.faceUpSins.length > 1),
        ) ||
        v.sinDeck.length < 6)
    )
      throw new IntegrityError("SIN_CAPACITY");
    if (v.phase.kind !== "awaitingTurnAction" && !v.pending)
      throw new IntegrityError("PHASE_CONTINUATION");
    if (
      v.resolvingSin &&
      !v.stack.some((f) => f.heldOutSinId === v.resolvingSin)
    )
      throw new IntegrityError("PHASE_CONTINUATION");
    if (
      v.revealedConspiracy !==
      v.stack.find((f) => f.kind === "conspiracy")?.conspiracyCardId
    )
      throw new IntegrityError("PHASE_CONTINUATION");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v.phase.deadline))
      throw new IntegrityError("OPPORTUNITY_DEADLINE");
  } else if (
    v.phase.kind !== "finished" ||
    !v.endReason ||
    !r.memberFacingExpiry
  )
    throw new IntegrityError("GAME_SHAPE");
}
