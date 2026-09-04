/** One interaction model for semantic controls and canvas highlights. */
export class InteractionController {
  constructor() {
    this.items = new Map();
    this.hovered = null;
    this.focused = null;
    this.pressed = null;
    this.pending = null;
  }
  state(id) {
    const item = this.items.get(id) ?? {};
    const hovered = this.hovered === id;
    const focused = this.focused === id;
    const pressed = this.pressed === id && !item.disabled;
    const pending = this.pending === id;
    return {
      ...item, hovered, focused, pressed, pending,
      state: pending ? 'pending' : item.disabled ? 'disabled' : item.invalid ? 'invalid'
        : pressed ? 'pressed' : item.selected ? 'selected' : hovered || focused ? 'hovered' : 'idle',
    };
  }
  set(id, properties) { this.items.set(id, { ...this.items.get(id), ...properties }); }
  remove(id) {
    this.items.delete(id);
    for (const key of ['hovered', 'focused', 'pressed', 'pending'])
      if (this[key] === id) this[key] = null;
  }
  clear() {
    this.items.clear();
    this.hovered = this.focused = this.pressed = this.pending = null;
  }
}

export function actionIdentity(action) {
  return action?.promptId ?? action?.interactionId ?? action?.opportunityId ?? '';
}

export function decisionIdentity(view) {
  if (!view) return '';
  const self = view.self ?? {};
  const action = (self.legalActions ?? []).find((a) => a.type.startsWith('game.'));
  return `${view.roomId}:${self.prompt?.promptId ?? actionIdentity(action) ?? ''}`;
}

export function decisionDeadline(view) {
  return view?.self?.prompt?.deadline ?? view?.public?.interaction?.deadline ?? view?.public?.turn?.deadline ?? null;
}

/** Called at activation, never trusts a previous frame's enabled state. */
export function currentLegalAction(store, type, expectedIdentity) {
  const view = store.view;
  if (!view || !store.connected || store.pending?.size) return null;
  const action = view.self?.legalActions?.find((a) => a.type === type);
  if (!action || (expectedIdentity !== undefined && actionIdentity(action) !== expectedIdentity)) return null;
  if (type.startsWith('game.')) {
    const deadline = decisionDeadline(view);
    if (view.public.room.status === 'finished' || (deadline && Date.parse(deadline) <= store.now())) return null;
    if (type === 'game.answerPrompt' && view.self.prompt?.submitted) return null;
  }
  return action;
}

export function validPromptAnswer(prompt, answer, hand = []) {
  if (!prompt || prompt.submitted || answer.kind !== prompt.kind) return false;
  const eligible = prompt.eligibleHandCardRefs ?? [];
  const held = new Set(hand.map((c) => c.handCardRef));
  const permitted = (ref) => eligible.includes(ref) && held.has(ref);
  switch (prompt.kind) {
    case 'selectPlayer': return (prompt.eligiblePlayerIds ?? []).includes(answer.playerId);
    case 'selectDirection': return (prompt.options ?? []).includes(answer.direction);
    case 'selectPayment': return (prompt.options ?? []).includes(answer.choice);
    case 'selectCard':
    case 'selectHerejiaCard': return permitted(answer.handCardRef);
    case 'selectCards': return Array.isArray(answer.handCardRefs)
      && answer.handCardRefs.length === (prompt.count ?? 2)
      && new Set(answer.handCardRefs).size === answer.handCardRefs.length
      && answer.handCardRefs.every(permitted);
    default: return false;
  }
}

/** Engine direction follows immutable clockwise seat order, skipping eliminated seats. */
export function activeNeighbor(players, playerId, direction) {
  const active = [...players].filter((p) => p.status !== 'eliminated').sort((a, b) => a.seatIndex - b.seatIndex);
  const index = active.findIndex((p) => p.playerId === playerId);
  if (index < 0 || active.length < 2) return null;
  return active[(index + (direction === 'right' ? 1 : -1) + active.length) % active.length];
}
