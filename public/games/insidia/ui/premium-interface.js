import { sins, conspiracies, purposes, effectText, errors } from './strings.js';
import { assets } from '../media/assets.js';
import { drawImageAsset } from './card-art.js';
import { AccessibilityLayer } from './accessibility-layer.js';
import { InteractionController, actionIdentity, decisionIdentity, decisionDeadline, currentLegalAction, validPromptAnswer, activeNeighbor } from './interaction-controller.js';

const nameOf = (players, id) => players.find((p) => p.playerId === id)?.displayName ?? 'La mesa';
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
const el = (tag, className, parent, content) => {
  const node = document.createElement(tag);
  node.className = className;
  if (content) node.textContent = content;
  parent?.append(node);
  return node;
};
const place = (node, rect) => {
  if (!rect) return;
  node.style.left = `${rect.x}px`; node.style.top = `${rect.y}px`;
  node.style.width = `${rect.w}px`; node.style.height = `${rect.h}px`;
};
const LOCAL_PURPOSES = {
  envidiaBottomOrder: 'Elige 2 cartas, en orden',
  lujuriaGiveCard: 'Entregar · elige un pecado de tu mano',
  lujuriaReturnCard: 'Devolver · puedes devolver el pecado recibido',
  herejiaCards: 'Elige un pecado para entregar a tu vecino',
};
const resultTitle = (pub) => pub.result?.endReason === 'draw' ? 'Nadie queda en pie.'
  : pub.result?.endReason === 'abandoned' ? 'La mesa quedó en silencio.'
    : `${nameOf(pub.players, pub.result?.winnerPlayerId)} gana.`;

/** DOM owns activation; canvas consumes this.interaction and the same CSS-pixel layout. */
export class PremiumInterface {
  constructor(store, dispatch, home) {
    this.store = store;
    this.dispatch = dispatch;
    this.home = home;
    this.interaction = new InteractionController();
    this.selected = [];
    this.selectedTarget = null;
    this.selectedDirection = null;
    this.scope = '';
    this.roomId = null;
    this.tray = false;
    this.forceTarget = false;
    this.declaredSin = null;
    this.inspection = null;
    this.historyOpen = false;
    this.resultDismissed = false;
    this.finishedAt = null;
    this.lastRoomStatus = null;
    this.history = [];
    this.historySeqs = new Set();
    this.error = '';
    this.pendingActionId = null;
    this.pendingAt = 0;
    this.layout = null;
    this.lastConnection = null;
    this.hoverTimer = null;
    this.visible = false;
    this.root = el('div', 'premium-ui', document.getElementById('stage'));
    this.root.id = 'premium-ui';
    this.a11y = new AccessibilityLayer(this.root, this.interaction);
    this.makeStructure();
    this.keyListener = (event) => {
      if (event.key !== 'Escape' || !this.visible) return;
      if (this.inspection) this.closeInspection();
      else if (this.historyOpen) this.historyOpen = false;
      else if (this.tray || this.forceTarget || this.selected.length || this.selectedTarget || this.selectedDirection) {
        this.tray = this.forceTarget = false;
        this.selected = [];
        this.selectedTarget = this.selectedDirection = null;
      } else return;
      event.preventDefault();
      this.render(this.layout);
    };
    document.addEventListener('keydown', this.keyListener);
    this.mediaQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    try { this.motionPreference = localStorage.getItem('insidia.motion') ?? 'system'; }
    catch { this.motionPreference = 'system'; }
    if (!['system', 'full', 'reduced'].includes(this.motionPreference)) this.motionPreference = 'system';
    this.mediaListener = () => this.applyMotion();
    this.mediaQuery?.addEventListener?.('change', this.mediaListener);
    this.motionSelect.value = this.motionPreference;
    this.applyMotion();
  }
  makeStructure() {
    this.utility = el('div', 'premium-utility', this.root);
    this.identity = el('span', 'premium-identity', this.utility);
    this.connection = el('span', 'premium-connection', this.utility);
    this.utilityButtons = el('div', 'premium-utility-buttons', this.utility);
    const motionLabel = el('label', 'premium-motion', this.utility, 'Movimiento');
    this.motionSelect = el('select', '', motionLabel);
    this.motionSelect.setAttribute('aria-label', 'Movimiento');
    for (const [value, label] of [['system', 'Sistema'], ['full', 'Completo'], ['reduced', 'Reducido']]) {
      const option = el('option', '', this.motionSelect, label); option.value = value;
    }
    this.motionSelect.addEventListener('change', () => {
      this.motionPreference = this.motionSelect.value;
      try { localStorage.setItem('insidia.motion', this.motionPreference); } catch { /* Private browsing may deny storage. */ }
      this.applyMotion();
    });
    this.cardControls = el('div', 'premium-card-controls', this.root);
    this.seatControls = el('div', 'premium-seat-controls', this.root);
    this.exposureControls = el('div', 'premium-exposure-controls', this.root);
    this.decision = el('section', 'premium-decision', this.root);
    this.decision.tabIndex = -1;
    this.decision.setAttribute('aria-label', 'Decisión actual');
    const context = el('div', 'premium-decision-context', this.decision);
    this.decisionLabel = el('div', 'premium-eyebrow', context);
    this.decisionTitle = el('h2', 'premium-decision-title', context);
    this.decisionMeta = el('p', 'premium-decision-meta', context);
    this.timer = el('div', 'premium-timer', context);
    this.timer.setAttribute('role', 'timer');
    this.timer.setAttribute('aria-live', 'off');
    this.decisionContent = el('div', 'premium-decision-content', this.decision);
    this.instruction = el('p', 'premium-instruction', this.decisionContent);
    this.actionButtons = el('div', 'premium-action-buttons', this.decisionContent);
    this.selectionPreview = el('p', 'premium-selection-preview', this.decisionContent);
    this.orderButtons = el('div', 'premium-order-buttons', this.decisionContent);
    this.targetList = el('div', 'premium-target-list', this.decisionContent);
    this.targetList.setAttribute('aria-label', 'Jugadores elegibles');
    this.trayNode = el('section', 'premium-drawer premium-declaration-tray', this.root);
    this.trayNode.setAttribute('aria-label', 'Pecados disponibles para declarar');
    el('h3', '', this.trayNode, 'Declara un pecado');
    el('p', 'premium-help', this.trayNode, 'No necesitas tenerlo. Solo debes poder pagar su coste.');
    this.sinButtons = el('div', 'premium-sin-grid', this.trayNode);
    this.sinDetail = el('p', 'premium-sin-detail', this.decisionContent);
    this.sinConfirm = el('div', 'premium-sin-confirm', this.decision);
    this.actionError = el('p', 'premium-action-error', this.decisionContent);
    this.actionError.setAttribute('role', 'status');
    this.latest = el('p', 'premium-latest', this.decisionContent);
    this.revealButtons = el('div', 'premium-reveal-buttons', this.decisionContent);
    this.historyPanel = el('section', 'premium-drawer premium-history', this.root);
    this.historyPanel.setAttribute('aria-label', 'Historia pública');
    el('h2', '', this.historyPanel, 'Lo que se sabe');
    this.historyClose = el('div', 'premium-panel-close', this.historyPanel);
    this.historyNotice = el('p', 'premium-help', this.historyPanel);
    this.historyButtons = el('div', 'premium-history-items', this.historyPanel);
    this.inspector = el('section', 'premium-drawer premium-inspector', this.root);
    this.inspector.setAttribute('aria-label', 'Inspección de cartas y reglas');
    this.inspectorTitle = el('h2', '', this.inspector);
    this.inspectorClose = el('div', 'premium-panel-close', this.inspector);
    this.inspectorBody = el('div', 'premium-inspector-body', this.inspector);
    this.result = el('section', 'premium-result', this.root);
    this.result.setAttribute('aria-label', 'Resultado de la partida');
    this.resultTitle = el('h2', '', this.result);
    this.resultReason = el('p', '', this.result);
    this.resultButtons = el('div', 'premium-result-buttons', this.result);
    this.expiry = el('p', 'premium-help', this.result);
  }
  get reducedMotion() {
    return this.motionPreference === 'reduced' || (this.motionPreference === 'system' && !!this.mediaQuery?.matches);
  }
  applyMotion() {
    this.root.dataset.motion = this.reducedMotion ? 'reduced' : 'full';
    this.store.presentation?.setMotionPreference?.(this.motionPreference);
  }
  resetRoom(roomId) {
    this.roomId = roomId;
    this.scope = '';
    this.selected = [];
    this.selectedTarget = this.selectedDirection = this.declaredSin = null;
    this.tray = this.forceTarget = this.historyOpen = this.resultDismissed = false;
    this.inspection = null;
    this.inspectionKey = null;
    this.inspectionReturnFocus = null;
    this.inspectorBody.replaceChildren();
    this.history = [];
    this.historySeqs.clear();
    this.error = '';
    this.pendingActionId = null;
    this.finishedAt = null;
    this.lastRoomStatus = null;
    this.interaction.clear();
    this.a11y.reset();
    clearTimeout(this.hoverTimer);
  }
  command(type, identity, payload, id, validate = () => true) {
    const action = currentLegalAction(this.store, type, identity);
    if (!action || !validate(action, this.store.view)) {
      this.error = 'La mesa ha cambiado. Revisa la decisión actual.';
      this.interaction.set(id, { invalid: true });
      this.render(this.layout);
      return false;
    }
    const accepted = this.dispatch.send(type, payload, undefined, id);
    if (accepted !== false) {
      this.pendingActionId = id;
      this.pendingAt = performance.now();
      this.interaction.pending = id;
      this.error = '';
    } else {
      const feedback = this.store.commandFeedback;
      if (feedback?.status === 'rejected' && feedback.origin === id) this.error = errors[feedback.code] ?? 'La decisión no se pudo completar. Revisa la mesa.';
      this.interaction.set(id, { invalid: true });
    }
    this.render(this.layout);
    return accepted;
  }
  answer(answer, expectedPromptId, id) {
    return this.command('game.answerPrompt', expectedPromptId, { promptId: expectedPromptId, answer }, id,
      (_action, view) => view.self.prompt?.promptId === expectedPromptId && validPromptAnswer(view.self.prompt, answer, view.self.hand));
  }
  actionSpec(type, label, options = {}) {
    const action = this.store.view.self.legalActions.find((a) => a.type === type);
    const identity = actionIdentity(action);
    const id = options.id ?? `action:${type}:${identity}`;
    const disabled = !action || this.busy || (type.startsWith('game.') && this.expired) || !this.store.connected || !!options.disabled;
    return {
      id, scope: this.scope, label, disabled, reason: options.reason,
      className: options.primary ? 'premium-primary' : '',
      pending: this.pendingActionId === id && this.busy,
      activate: options.activate ?? (() => this.command(type, identity, identity ? { [action.promptId ? 'promptId' : action.interactionId ? 'interactionId' : 'opportunityId']: identity } : {}, id)),
    };
  }
  localSpec(id, label, activate, options = {}) {
    return { id, label, activate: () => { activate(); this.render(this.layout); }, scope: this.scope, ...options };
  }
  render(layout) {
    if (!layout || !this.store.view?.public?.board) { this.hide(); return; }
    this.layout = layout;
    const view = this.store.view, pub = view.public, self = view.self, players = pub.players;
    if (view.roomId !== this.roomId) this.resetRoom(view.roomId);
    this.visible = true;
    this.root.hidden = false;
    this.root.dataset.compact = String(layout.width < 1200 || layout.height < 650);
    this.root.dataset.connected = String(this.store.connected);
    const compact = layout.width < 1200 || layout.height < 650;
    const railWidth = compact ? 284 : 330;
    const decisionRect = layout.decision ?? { x: layout.width - railWidth - 12, y: 64, w: railWidth, h: layout.height - 80 };
    const drawerRect = layout.inspector ?? { x: 12, y: 64, w: Math.min(420, layout.width - railWidth - 36), h: Math.max(170, layout.height - 290) };
    place(this.decision, decisionRect);
    place(this.utility, layout.utility ?? { x: 12, y: 8, w: layout.width - 24, h: 44 });
    place(this.inspector, drawerRect);
    place(this.trayNode, drawerRect);
    place(this.historyPanel, layout.history ?? drawerRect);
    place(this.result, { x: 24, y: Math.max(64, layout.height * .24), w: Math.max(240, layout.width - railWidth - 60), h: Math.min(340, layout.height - 90) });
    const nextScope = decisionIdentity(view);
    const changedScope = nextScope !== this.scope;
    const focusedBefore = document.activeElement;
    if (changedScope) {
      this.scope = nextScope;
      this.selected = [];
      this.selectedTarget = this.selectedDirection = this.declaredSin = null;
      this.tray = this.forceTarget = false;
      this.error = '';
    }
    const hand = self.hand ?? [];
    this.selected = this.selected.filter((ref) => self.prompt?.eligibleHandCardRefs?.includes(ref) && hand.some((c) => c.handCardRef === ref));
    const eligibleTargets = this.forceTarget ? self.legalActions.find((a) => a.type === 'game.forceRandomDiscard')?.eligiblePlayerIds : self.prompt?.eligiblePlayerIds;
    if (!eligibleTargets?.includes(this.selectedTarget)) this.selectedTarget = null;
    if (self.prompt?.kind === 'selectDirection' && !self.prompt.options?.includes(this.selectedDirection)) this.selectedDirection = null;
    if (self.prompt?.submitted || !this.store.connected || pub.room.status === 'finished') {
      this.selected = [];
      this.selectedTarget = this.selectedDirection = null;
      if (this.inspection?.privateRef) this.closeInspection(false);
    }
    if (this.inspection?.privateRef && !hand.some((c) => c.handCardRef === this.inspection.privateRef)) this.closeInspection(false);
    this.busy = this.store.pending.size > 0;
    this.deadline = decisionDeadline(view);
    this.expired = !!this.deadline && Date.parse(this.deadline) <= this.store.now();
    if (!this.busy && this.pendingActionId) {
      const feedback = this.store.commandFeedback;
      const code = feedback?.status === 'rejected' ? feedback.code : this.store.error;
      if (code) this.error = errors[code] ?? 'La decisión no se pudo completar. Revisa la mesa.';
      this.pendingActionId = null;
      this.interaction.pending = null;
    }
    if (!this.store.connected) {
      this.tray = this.forceTarget = false;
      this.clearPrivateControls();
    }
    if (this.lastConnection !== this.store.connected) {
      this.a11y.announce('connection', this.store.connected ? 'Conectado con la mesa.' : 'Reconectando con la mesa. Las decisiones están desactivadas.');
      this.lastConnection = this.store.connected;
    }
    this.renderUtility(pub);
    this.ingestHistory(pub);
    if (self.prompt?.submitted) this.a11y.announce(`submitted:${self.prompt.promptId}`, 'Tu elección está sellada.');
    const localDecision = self.legalActions.some((a) => a.type.startsWith('game.')) && !self.prompt?.submitted;
    this.renderDecision(view, localDecision);
    this.renderCards(layout, view);
    this.renderTargets(layout, view);
    this.renderHistory(pub);
    this.renderInspection();
    this.renderResults(pub);
    this.renderSummary(view);
    if (focusedBefore && !focusedBefore.isConnected && focusedBefore !== document.body) this.decision.focus({ preventScroll: true });
    if (!this.home?.rulesSuspended) this.rulesSuspensionSeen = false;
    if (changedScope && localDecision) {
      const suspendedModal = this.home?.syncRules?.() || (this.home?.rulesSuspended && !this.rulesSuspensionSeen);
      if (suspendedModal) { this.decision.focus({ preventScroll: true }); this.rulesSuspensionSeen = true; }
      this.a11y.announce('decision', `${this.decisionTitle.textContent}. ${this.instruction.textContent}`);
      // Reading remains nonmodal. Move focus when its previous target vanished, or a modal was closed.
      if (focusedBefore && !focusedBefore.isConnected && focusedBefore !== document.body) this.decision.focus({ preventScroll: true });
    }
  }
  renderUtility(pub) {
    text(this.identity, `INSIDIA · Turno ${pub.turn.turnNumber}`);
    text(this.connection, this.store.connected ? '● Conectado' : 'Reconectando…');
    this.a11y.buttons(this.utilityButtons, [
      this.localSpec('utility:history', 'Historia', () => { this.historyOpen = !this.historyOpen; if (this.historyOpen) this.inspection = null; }, { expanded: this.historyOpen }),
      this.localSpec('utility:rules', 'Cómo jugar', () => this.openRules(), { expanded: this.inspection?.kind === 'rules' }),
    ]);
  }
  renderDecision(view, localDecision) {
    const { public: pub, self } = view, players = pub.players, interaction = pub.interaction;
    const actor = interaction?.actorPlayerId ?? pub.turn.activePlayerId ?? pub.turn.lastActivePlayerId;
    const responder = interaction?.currentResponderId ?? interaction?.playerId ?? pub.turn.activePlayerId;
    const prompt = self.prompt;
    const playerName = nameOf(players, responder);
    text(this.decisionLabel, pub.room.status === 'finished' ? 'EL PACTO HA TERMINADO' : localDecision ? 'TU DECISIÓN' : 'EN LA MESA');
    let title = localDecision ? 'Haz tu jugada.' : `Esperando a ${playerName}`;
    if (interaction?.declaredSin) title = `${nameOf(players, actor)} declara ${sins[interaction.declaredSin]?.name ?? 'un pecado'}`;
    if (prompt) title = prompt.submitted ? 'Tu elección está sellada.' : (LOCAL_PURPOSES[prompt.purpose] ?? purposes[prompt.purpose] ?? 'Elige tu respuesta');
    else if (interaction?.kind === 'simultaneousCards') title = 'Herejía · intercambio simultáneo';
    if (pub.room.status === 'finished') title = resultTitle(pub);
    text(this.decisionTitle, title);
    let meta = `Actúa: ${nameOf(players, actor)}`;
    if (interaction?.kind === 'simultaneousCards') meta += ' · Elecciones privadas';
    else if (responder === actor && interaction) meta = `Actúa y responde: ${playerName}`;
    else if (responder && (responder !== actor || interaction)) meta += ` · Responde: ${playerName}`;
    if (interaction?.targetPlayerId) meta += ` · Objetivo: ${nameOf(players, interaction.targetPlayerId)}`;
    text(this.decisionMeta, meta);
    const seconds = this.deadline ? Math.max(0, Math.ceil((Date.parse(this.deadline) - this.store.now()) / 1000)) : null;
    text(this.timer, seconds === null ? '' : `${seconds} s · ${this.expired ? 'Esperando resolución' : localDecision ? 'para decidir' : 'tiempo de respuesta'}`);
    this.timer.dataset.urgent = String(seconds !== null && seconds <= 5);
    const actions = [];
    const find = (type) => self.legalActions.find((a) => a.type === type);
    let instruction = '';
    let selection = '';
    const order = [];
    const local = (id, label, fn, primary = false) => this.localSpec(id, label, fn, { disabled: this.busy || this.expired || !this.store.connected, className: primary ? 'premium-primary' : '' });
    if (!this.store.connected) instruction = 'Reconectando con la mesa… Podrás decidir cuando vuelva la conexión.';
    else if (prompt?.submitted) instruction = 'Tu elección permanece privada hasta que se resuelva el intercambio.';
    else if (this.busy) instruction = performance.now() - this.pendingAt > 5000 ? 'Confirmando tu decisión…' : 'Enviando tu decisión…';
    if (find('game.takeSouls') && !this.tray && !this.forceTarget) {
      actions.push(this.actionSpec('game.takeSouls', `Tomar almas · +${Math.min(2, pub.board.soulBank)} ◇`));
      actions.push(local('open:declaration', 'Pecar →', () => { this.tray = true; }, true));
      actions.push(this.actionSpec('game.conspire', 'Conspirar · 1 alma', { reason: !find('game.conspire') ? 'Necesitas 1 alma.' : undefined }));
      actions.push(local('open:force-target', 'Forzar descarte · 8 almas', () => { this.forceTarget = true; }, false));
      const force = actions.at(-1);
      force.disabled ||= !find('game.forceRandomDiscard');
      force.reason = !find('game.forceRandomDiscard') ? 'Necesitas 8 almas y un rival con cartas.' : undefined;
      instruction ||= 'Elige una acción. Declarar un pecado no consume ninguna carta de tu mano.';
    } else if (find('game.challenge')) {
      actions.push(this.actionSpec('game.challenge', 'Desafiar la declaración', { primary: true }));
      actions.push(this.actionSpec('game.passChallenge', 'Dejar pasar'));
      instruction ||= 'Si la declaración es cierta, revelarás uno de tus pecados. Si es falsa, quien declaró revelará uno.';
    } else if (find('game.passCounter')) {
      const cost = pub.interaction.cost;
      const souls = players.find((p) => p.playerId === self.playerId)?.souls ?? 0;
      actions.push(this.actionSpec('game.payCounter', `Bloquear · ${cost} almas`, { primary: true, disabled: souls < cost, reason: souls < cost ? `Necesitas ${cost} almas.` : undefined }));
      actions.push(this.actionSpec('game.passCounter', 'No intervenir'));
      instruction ||= `El bloqueo detiene el efecto. Cuesta ${cost} almas.`;
    } else if ((prompt && !prompt.submitted) || this.forceTarget) {
      if (prompt?.kind === 'selectPlayer' || this.forceTarget) {
        const name = this.selectedTarget ? nameOf(players, this.selectedTarget) : null;
        selection = name ? this.targetConsequence(name, prompt?.purpose) : 'Selecciona un asiento iluminado o un nombre.';
        const action = this.forceTarget ? find('game.forceRandomDiscard') : find('game.answerPrompt');
        const identity = actionIdentity(action);
        const id = `confirm:target:${identity}`;
        actions.push(local(id, this.forceTarget ? 'Pagar 8 almas y confirmar' : 'Confirmar objetivo', () => {
          if (this.forceTarget) this.command('game.forceRandomDiscard', identity, { opportunityId: identity, targetPlayerId: this.selectedTarget }, id, (a) => a.eligiblePlayerIds?.includes(this.selectedTarget));
          else this.answer({ kind: 'selectPlayer', playerId: this.selectedTarget }, identity, id);
        }, true));
        actions.at(-1).disabled ||= !this.selectedTarget;
        if (this.forceTarget) actions.push(local('cancel:force-target', 'Cancelar', () => { this.forceTarget = false; this.selectedTarget = null; }));
      } else if (prompt.kind === 'selectDirection') {
        for (const direction of prompt.options ?? []) {
          const neighbor = activeNeighbor(players, self.playerId, direction);
          const label = `${direction === 'left' ? '← Izquierda' : 'Derecha →'} · ${neighbor?.displayName ?? 'vecino activo'}`;
          actions.push(local(`direction:${direction}:${prompt.promptId}`, label, () => { this.selectedDirection = direction; }));
          actions.at(-1).selected = this.selectedDirection === direction;
        }
        const id = `confirm:direction:${prompt.promptId}`;
        actions.push(local(id, 'Confirmar dirección', () => this.answer({ kind: 'selectDirection', direction: this.selectedDirection }, prompt.promptId, id), true));
        actions.at(-1).disabled ||= !this.selectedDirection;
        instruction ||= 'Todos entregan una carta al siguiente asiento activo en esa dirección.';
      } else if (prompt.kind === 'selectPayment') {
        if (prompt.options?.includes('pay')) {
          const id = `payment:pay:${prompt.promptId}`;
          actions.push(local(id, 'Pagar 3 almas · conservar la mano', () => this.answer({ kind: 'selectPayment', choice: 'pay' }, prompt.promptId, id), true));
        }
        if (prompt.options?.includes('discard')) {
          const id = `payment:discard:${prompt.promptId}`;
          actions.push(local(id, 'Conservar almas · revelar al azar', () => this.answer({ kind: 'selectPayment', choice: 'discard' }, prompt.promptId, id)));
        }
        instruction ||= 'Indigencia: decide qué perder. La carta revelada se elige al azar.';
      } else {
        const count = prompt.count ?? 1;
        const verb = prompt.purpose === 'lujuriaGiveCard' ? 'Entregar' : prompt.purpose === 'lujuriaReturnCard' ? 'Devolver' : prompt.kind === 'selectHerejiaCard' ? 'Sellar elección' : 'Confirmar';
        const id = `confirm:cards:${prompt.promptId}`;
        actions.push(local(id, `${verb} · ${this.selected.length}/${count}`, () => this.answer(prompt.kind === 'selectCards' ? { kind: prompt.kind, handCardRefs: [...this.selected] } : { kind: prompt.kind, handCardRef: this.selected[0] }, prompt.promptId, id), true));
        actions.at(-1).disabled ||= this.selected.length !== count;
        instruction ||= prompt.ordered ? '1 queda encima de 2 en el fondo del mazo. Puedes cambiar el orden antes de confirmar.' : 'Selecciona una carta de tu mano. El botón Leer permite inspeccionarla sin cambiar tu elección.';
        if (prompt.kind === 'selectHerejiaCard') {
          const neighbor = activeNeighbor(players, self.playerId, pub.interaction?.direction);
          selection = `Entregarás a ${neighbor?.displayName ?? 'tu vecino activo'}. Nadie ve tu elección antes de la resolución.`;
        }
        if (prompt.ordered) {
          selection = [0, 1].map((index) => `${index + 1}. ${sins[self.hand.find((c) => c.handCardRef === this.selected[index])?.sin]?.name ?? 'Elige una carta'}`).join(' → ');
          order.push(local(`order:swap:${prompt.promptId}`, 'Intercambiar 1 ↔ 2', () => this.selected.reverse()));
          order.at(-1).disabled ||= this.selected.length !== 2;
          order.push(local(`order:clear:${prompt.promptId}`, 'Elegir de nuevo', () => { this.selected = []; }));
          order.at(-1).disabled ||= !this.selected.length;
        }
      }
    } else if (pub.room.status !== 'finished') {
      instruction ||= interaction?.kind === 'simultaneousCards' ? 'Las cartas se entregarán simultáneamente al terminar la decisión.' : `Esperando a ${playerName}. Puedes inspeccionar las cartas y consultar la historia.`;
    }
    if (pub.room.status === 'finished') instruction = 'Puedes consultar la mesa y su historia pública.';
    if (!this.busy && this.store.commandFeedback?.status === 'rejected' && this.store.commandFeedback.origin === this.pendingActionId) this.error = errors[this.store.commandFeedback.code] ?? 'La decisión no se pudo completar.';
    for (const spec of actions) if (spec.id === this.pendingActionId && this.busy) spec.pending = true;
    if (this.tray) instruction = 'Elige un pecado en el catálogo de la mesa.';
    text(this.instruction, instruction);
    text(this.selectionPreview, selection);
    this.selectionPreview.hidden = !selection;
    this.a11y.buttons(this.actionButtons, actions);
    this.a11y.buttons(this.orderButtons, order);
    text(this.actionError, this.error);
    this.actionError.hidden = !this.error;
    this.renderDeclaration(view);
  }
  targetConsequence(name, purpose) {
    if (this.forceTarget) return `Pagar 8 almas · ${name} revela un pecado al azar.`;
    return ({ rabiaTarget: `${name} deberá revelar un pecado si no bloquea.`, avariciaTarget: `Robar hasta 2 almas a ${name}.`, lujuriaTarget: `${name} te entregará un pecado; después le devolverás uno.`, supremaciaTieTarget: `${name} toma hasta 3 almas.`, agoniaTieTarget: `${name} devuelve hasta 3 almas.` })[purpose] ?? `Objetivo: ${name}.`;
  }
  renderDeclaration(view) {
    const action = view.self.legalActions.find((a) => a.type === 'game.declareSin');
    const open = this.tray && !!action && this.store.connected && !this.expired;
    this.trayNode.hidden = !open || !!this.inspection || this.historyOpen;
    this.sinConfirm.hidden = !open;
    this.sinDetail.hidden = !open;
    this.decision.dataset.declaring = String(open);
    const specs = [];
    if (open) {
      for (const [sin, info] of Object.entries(sins)) {
        const allowed = action.allowedSins.includes(sin);
        specs.push(this.localSpec(`declare:${sin}`, `${info.name} · ${info.cost} ◇`, () => { this.declaredSin = sin; }, {
          selected: this.declaredSin === sin, disabled: !allowed || this.busy,
          reason: !allowed ? `Necesitas ${info.cost} almas.` : undefined,
          className: 'premium-sin-option',
        }));
        specs.push(this.localSpec(`reference:${sin}`, 'ⓘ', () => this.inspect(sin), { ariaLabel: `Leer ${info.name}, coste ${info.cost} almas`, className: 'premium-inspect-option' }));
      }
    }
    this.a11y.buttons(this.sinButtons, specs);
    const info = sins[this.declaredSin];
    text(this.sinDetail, info ? `${info.name} · ${info.cost} almas. ${info.description}` : 'Elige un pecado para leer su efecto y confirmar.');
    const confirm = [];
    if (open) {
      const identity = action.opportunityId;
      const id = `confirm:declaration:${identity}`;
      confirm.push(this.localSpec(id, info ? `Declarar ${info.name} · ${info.cost} almas` : 'Elige un pecado', () => this.command('game.declareSin', identity, { opportunityId: identity, sin: this.declaredSin }, id, (a) => a.allowedSins.includes(this.declaredSin)), { disabled: !info || this.busy, className: 'premium-primary', pending: this.pendingActionId === id && this.busy }));
      confirm.push(this.localSpec('cancel:declaration', 'Volver', () => { this.tray = false; this.declaredSin = null; }));
    }
    this.a11y.buttons(this.sinConfirm, confirm);
  }
  renderCards(layout, view) {
    const specs = [];
    const { self, public: pub } = view;
    const permitted = this.store.connected && pub.room.status !== 'finished';
    if (permitted) for (const bounds of layout.hand ?? []) {
      const card = self.hand.find((c) => c.handCardRef === bounds.handCardRef);
      if (!card) continue;
      const eligible = !self.prompt?.submitted && self.prompt?.eligibleHandCardRefs?.includes(card.handCardRef);
      const selected = this.selected.includes(card.handCardRef);
      const order = selected ? this.selected.indexOf(card.handCardRef) + 1 : null;
      const id = `hand:${card.handCardRef}`;
      const expectedPromptId = self.prompt?.promptId;
      const select = () => {
        const prompt = this.store.view.self.prompt;
        if (!currentLegalAction(this.store, 'game.answerPrompt', expectedPromptId) || prompt?.promptId !== expectedPromptId || !prompt?.eligibleHandCardRefs?.includes(card.handCardRef)) return;
        if (this.selected.includes(card.handCardRef)) this.selected = this.selected.filter((ref) => ref !== card.handCardRef);
        else if ((prompt.count ?? 1) === 1) this.selected = [card.handCardRef];
        else if (this.selected.length < prompt.count) this.selected.push(card.handCardRef);
        else this.error = 'Quita una carta seleccionada o elige de nuevo para reemplazarla.';
      };
      const inspectHeight = 44;
      specs.push(this.localSpec(id, selected ? `${order} · ${sins[card.sin].name}` : sins[card.sin].name, eligible ? select : () => this.inspect(card.sin, card.handCardRef), {
        selected, disabled: eligible && (this.busy || this.expired),
        ariaLabel: `${eligible ? 'Seleccionar' : 'Leer'} ${sins[card.sin].name}${selected ? `, posición ${order}` : ''}`,
        className: `premium-hand-body ${eligible ? 'premium-selectable' : ''}`,
        bounds: { x: bounds.x, y: bounds.y, w: Math.max(44, bounds.w), h: Math.max(44, bounds.h - inspectHeight - 8) },
        onHover: (hovering) => {
          clearTimeout(this.hoverTimer);
          if (!hovering && this.inspection?.pinned === false && this.inspection.privateRef === card.handCardRef) this.closeInspection(false);
          if (hovering && !this.inspection?.pinned) this.hoverTimer = setTimeout(() => {
            if (this.store.connected && this.store.view?.self?.hand?.some((c) => c.handCardRef === card.handCardRef)) {
              this.inspect(card.sin, card.handCardRef, false);
              this.render(this.layout);
            }
          }, 250);
        },
      }));
      specs.push(this.localSpec(`inspect:${card.handCardRef}`, 'Leer', () => this.inspect(card.sin, card.handCardRef), {
        ariaLabel: `Inspeccionar ${sins[card.sin].name} sin cambiar la selección`, className: 'premium-hand-inspect',
        bounds: { x: bounds.x, y: bounds.y + bounds.h - inspectHeight, w: Math.max(44, bounds.w), h: inspectHeight },
      }));
    }
    this.a11y.buttons(this.cardControls, specs);
    const exposed = [];
    for (const seat of layout.seats ?? []) {
      const player = pub.players.find((p) => p.playerId === seat.playerId);
      if (!player?.faceUpSins?.length) continue;
      exposed.push(this.localSpec(`exposure:${seat.playerId}`, 'ⓘ', () => {
        this.inspectionReturnFocus = document.activeElement;
        this.inspection = { kind: 'exposures', playerId: seat.playerId, pinned: true };
        this.historyOpen = false;
      }, { className: 'premium-public-card', ariaLabel: `Leer ${player.faceUpSins.length} pecados expuestos de ${player.displayName}`, bounds: { x: seat.x + seat.w - 44, y: seat.y + seat.h - 44, w: 44, h: 44 } }));
    }
    this.a11y.buttons(this.exposureControls, exposed);
  }
  renderTargets(layout, view) {
    const action = view.self.legalActions.find((a) => a.type === 'game.forceRandomDiscard');
    const prompt = view.self.prompt;
    const ids = this.forceTarget ? action?.eligiblePlayerIds ?? [] : prompt?.kind === 'selectPlayer' && !prompt.submitted ? prompt.eligiblePlayerIds : [];
    if (!ids.includes(this.selectedTarget)) this.selectedTarget = null;
    const specs = [], list = [];
    for (const playerId of ids) {
      const player = view.public.players.find((p) => p.playerId === playerId);
      if (!player) continue;
      const select = () => {
        const fresh = this.forceTarget ? currentLegalAction(this.store, 'game.forceRandomDiscard', action?.opportunityId)?.eligiblePlayerIds : currentLegalAction(this.store, 'game.answerPrompt', prompt?.promptId) && this.store.view.self.prompt?.eligiblePlayerIds;
        if (fresh?.includes(playerId)) this.selectedTarget = playerId;
      };
      const options = { selected: this.selectedTarget === playerId, disabled: this.busy || this.expired || !this.store.connected };
      const bounds = layout.seats?.find((s) => s.playerId === playerId);
      if (bounds) specs.push(this.localSpec(`target:${playerId}`, this.selectedTarget === playerId ? 'Objetivo seleccionado' : 'Elegir objetivo', select, { ...options, className: 'premium-seat-target', ariaLabel: `Elegir a ${player.displayName}, ${player.souls} almas`, bounds: { ...bounds, w: player.faceUpSins.length ? Math.max(44, bounds.w - 52) : bounds.w } }));
      list.push(this.localSpec(`target-list:${playerId}`, `${player.displayName} · ${player.souls} ◇`, select, options));
    }
    this.a11y.buttons(this.seatControls, specs);
    this.a11y.buttons(this.targetList, list);
    this.targetList.hidden = !list.length;
  }
  inspect(sin, privateRef = null, pinned = true) {
    if (!sins[sin]) return;
    this.inspectionReturnFocus = document.activeElement;
    this.inspection = { kind: 'sin', sin, privateRef, pinned };
    this.historyOpen = false;
  }
  inspectConspiracy(conspiracy) {
    if (!conspiracies[conspiracy]) return;
    this.inspectionReturnFocus = document.activeElement;
    this.inspection = { kind: 'conspiracy', conspiracy, pinned: true };
    this.historyOpen = false;
  }
  openRules() {
    this.inspectionReturnFocus = document.activeElement;
    this.inspection = { kind: 'rules', pinned: true };
    this.historyOpen = false;
  }
  closeInspection(restoreFocus = true) {
    this.inspection = null;
    this.inspectionKey = null;
    this.inspectorBody.replaceChildren();
    const returnFocus = this.inspectionReturnFocus;
    this.inspectionReturnFocus = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  renderInspection() {
    this.inspector.hidden = !this.inspection;
    this.a11y.buttons(this.inspectorClose, this.inspection ? [this.localSpec('close:inspector', 'Cerrar', () => this.closeInspection())] : []);
    if (!this.inspection) return;
    const exposureOwner = this.inspection.kind === 'exposures' ? this.store.view.public.players.find((p) => p.playerId === this.inspection.playerId) : null;
    const key = `${this.inspection.kind}:${this.inspection.sin ?? this.inspection.conspiracy ?? ''}:${exposureOwner ? exposureOwner.playerId + exposureOwner.faceUpSins.map((c) => c.sin).join(',') : ''}`;
    if (key === this.inspectionKey) return;
    this.inspectionKey = key;
    this.inspectorBody.replaceChildren();
    this.inspector.scrollTop = 0;
    if (this.inspection.kind === 'rules') {
      text(this.inspectorTitle, 'Confía en nadie.');
      el('p', '', this.inspectorBody, 'Gana al resolver Orgullo sin que lo bloqueen, o al ser el último jugador con menos de dos pecados expuestos. Empiezas con 2 almas y 2 pecados ocultos.');
      el('h3', '', this.inspectorBody, 'En tu turno');
      el('p', '', this.inspectorBody, 'Toma hasta 2 almas, conspira por 1 alma, fuerza un descarte al azar por 8 almas o declara un pecado que puedas pagar. No necesitas tenerlo en tu mano.');
      el('h3', '', this.inspectorBody, 'Declaración y desafío');
      el('p', '', this.inspectorBody, 'Los rivales deciden si desafiar por turnos. Si mentías, revelas un pecado al azar y tu acción termina sin pagar. Si decías la verdad, el desafiante revela uno y tu efecto continúa. Al terminar, las manos vuelven a dos cartas y se eliminan quienes tengan dos o más pecados expuestos.');
      for (const info of Object.values(sins)) {
        el('h3', '', this.inspectorBody, `${info.name} · ${info.cost} almas`);
        el('p', '', this.inspectorBody, info.description);
      }
      for (const [title, description] of Object.values(conspiracies)) {
        el('h3', '', this.inspectorBody, title); el('p', '', this.inspectorBody, description);
      }
    } else if (this.inspection.kind === 'exposures') {
      text(this.inspectorTitle, `Pecados de ${exposureOwner?.displayName ?? 'la mesa'}`);
      for (const card of exposureOwner?.faceUpSins ?? []) {
        el('h3', '', this.inspectorBody, sins[card.sin].name);
        this.inspectorArt(card.sin, true);
        el('p', '', this.inspectorBody, sins[card.sin].description);
      }
      if (!exposureOwner?.faceUpSins.length) el('p', '', this.inspectorBody, 'No tiene pecados expuestos.');
    } else {
      const isSin = this.inspection.kind === 'sin';
      const info = isSin ? sins[this.inspection.sin] : conspiracies[this.inspection.conspiracy];
      text(this.inspectorTitle, isSin ? info.name : info[0]);
      this.inspectorArt(isSin ? this.inspection.sin : this.inspection.conspiracy, isSin);
      if (isSin) el('p', 'premium-inspector-cost', this.inspectorBody, `Coste de declaración: ${info.cost} almas`);
      el('p', '', this.inspectorBody, isSin ? info.description : info[1]);
    }
    el('p', 'premium-help', this.inspectorBody, 'El reloj sigue corriendo. La decisión actual permanece disponible a la derecha.');
  }
  inspectorArt(definition, isSin) {
    const canvas = el('canvas', `premium-inspector-art ${isSin ? '' : 'premium-wide-art'}`, this.inspectorBody);
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = isSin ? 380 : 660;
    canvas.height = isSin ? 532 : 471;
    const asset = isSin ? assets.pecadoFronts[definition] : assets.conspiracyFronts[definition];
    if (!drawImageAsset(canvas.getContext('2d'), asset, 0, 0, canvas.width, canvas.height, 12)) canvas.remove();
  }
  ingestHistory(pub) {
    const effects = this.store.presentation?.history ?? pub.recentEffects ?? [];
    const first = this.history.length === 0;
    const announcements = [];
    for (const value of effects) {
      const effect = value.effect ?? value;
      if (!effect.effectSeq || this.historySeqs.has(effect.effectSeq)) continue;
      this.historySeqs.add(effect.effectSeq);
      this.history.push(effect);
      if (!first && ['claimProven', 'sinExposed', 'playerEliminated', 'gameFinished'].includes(effect.kind)) announcements.push(effectText(effect, pub.players));
    }
    if (announcements.length) this.a11y.announce(`effects:${this.history.at(-1)?.effectSeq}`, announcements.slice(0, 5).join(' '));
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
    // Deduplication is bounded to retained entries plus the current server ring.
    if (this.historySeqs.size > 260) this.historySeqs = new Set(this.history.map((e) => e.effectSeq));
  }
  renderHistory(pub) {
    const last = this.history.at(-1);
    const currentGroup = last?.stateVersion !== undefined ? this.history.filter((e) => e.stateVersion === last.stateVersion) : last ? [last] : [];
    const meaningful = currentGroup.filter((e) => ['claimProven', 'sinExposed', 'sinCountered', 'soulsPaid', 'soulsGained', 'soulsStolen', 'playerEliminated', 'gameFinished'].includes(e.kind));
    const outcomes = meaningful.length ? meaningful : currentGroup;
    const facts = outcomes.slice(0, 4).map((e) => `${e.kind === 'claimProven' ? 'Demostrado · ' : ''}${effectText(e, pub.players)}`);
    text(this.latest, facts.length ? `Último resultado · ${facts.join(' ')}${outcomes.length > 4 ? ' Consulta la historia para ver el resto.' : ''}` : 'La mesa guarda silencio.');
    this.latest.hidden = this.tray;
    this.historyPanel.hidden = !this.historyOpen;
    const reveals = [...(this.store.presentation?.reveals ?? [])];
    const activeConspiracy = pub.board.revealedConspiracy?.conspiracy;
    if (activeConspiracy && !reveals.some((r) => r.conspiracy === activeConspiracy)) reveals.push({ conspiracy: activeConspiracy, key: 'active' });
    this.a11y.buttons(this.revealButtons, reveals.slice(-2).filter((r) => conspiracies[r.conspiracy]).map((r, i) => this.localSpec(`reveal:${r.key ?? r.effectSeq ?? i}`, `${conspiracies[r.conspiracy][0]} · ${conspiracies[r.conspiracy][1]} · Leer`, () => this.inspectConspiracy(r.conspiracy), { className: 'premium-reveal-reference' })));
    text(this.historyNotice, 'Actividad reciente · hasta 200 sucesos públicos observados. Al reconectar, la historia anterior puede no estar disponible.');
    this.a11y.buttons(this.historyClose, this.historyOpen ? [this.localSpec('close:history', 'Cerrar', () => { this.historyOpen = false; })] : []);
    const specs = this.historyOpen ? [...this.history].reverse().map((effect) => {
      const label = effectText(effect, pub.players);
      const readable = (['claimProven', 'sinExposed', 'sinDeclared', 'sinCountered'].includes(effect.kind) && sins[effect.sin]) || (effect.kind === 'conspiracyRevealed' && conspiracies[effect.conspiracy]);
      return this.localSpec(`history:${effect.effectSeq}`, `${label}${readable ? ' · Leer carta' : ''}`, () => {
        if (effect.kind === 'conspiracyRevealed') this.inspectConspiracy(effect.conspiracy);
        else if (readable) this.inspect(effect.sin);
      }, { className: 'premium-history-entry', disabled: !readable });
    }) : [];
    this.a11y.buttons(this.historyButtons, specs);
  }
  renderResults(pub) {
    const finished = pub.room.status === 'finished';
    if (finished && this.lastRoomStatus && this.lastRoomStatus !== 'finished' && pub.result?.endReason !== 'abandoned') this.finishedAt = performance.now();
    this.lastRoomStatus = pub.room.status;
    const emphasizing = finished && this.finishedAt !== null && performance.now() - this.finishedAt < 1500;
    this.result.hidden = !finished || this.resultDismissed || emphasizing;
    text(this.resultTitle, finished ? resultTitle(pub) : '');
    text(this.resultReason, ({ orgullo: 'El orgullo ha sido su salvación.', last_survivor: 'La última alma en pie.', abandoned: 'Todos los humanos se desconectaron.', draw: 'Todos revelaron demasiados pecados.' })[pub.result?.endReason] ?? '');
    const specs = finished ? [this.localSpec('result:view', 'Ver mesa', () => { this.resultDismissed = true; }), this.actionSpec('room.leave', 'Volver al inicio', { primary: true })] : [];
    this.a11y.buttons(this.resultButtons, specs);
    if (emphasizing) {
      this.a11y.buttons(this.actionButtons, [this.localSpec('result:skip', 'Ver resultado', () => { this.finishedAt = null; })]);
    } else if (finished && this.resultDismissed) {
      // The decision rail stays visible as the persistent result badge.
      this.a11y.buttons(this.actionButtons, [this.localSpec('result:show', 'Ver resultado', () => { this.resultDismissed = false; }), this.actionSpec('room.leave', 'Volver al inicio', { primary: true })]);
    }
    if (finished) {
      const seconds = Math.max(0, Math.ceil((Date.parse(pub.room.memberFacingExpiresAt) - this.store.now()) / 1000));
      text(this.expiry, Number.isFinite(seconds) ? `Esta sala se cerrará en ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '');
      this.a11y.announce('result', `${this.resultTitle.textContent} ${this.resultReason.textContent}`);
    }
  }
  renderSummary(view) {
    const pub = view.public;
    const summary = [...pub.players].sort((a, b) => a.seatIndex - b.seatIndex).map((p) => `${p.displayName}: ${p.souls} almas, ${p.handCount} cartas, ${p.faceUpSins.length} pecados expuestos${p.faceUpSins.length ? ` (${p.faceUpSins.map((c) => sins[c.sin].name).join(', ')})` : ''}${p.status === 'eliminated' ? ', eliminado' : p.faceUpSins.length >= 2 ? ', eliminación pendiente' : ''}.`).join(' ');
    const own = this.store.connected && pub.room.status !== 'finished' ? ` Tu mano: ${(view.self.hand ?? []).map((c) => sins[c.sin].name).join(', ')}.` : '';
    this.a11y.setSummary(`${summary} ${this.decisionTitle.textContent}. ${this.decisionMeta.textContent}. ${this.timer.textContent}.${own}`);
  }
  clearPrivateControls() {
    this.a11y.buttons(this.cardControls, []);
    if (this.inspection?.privateRef) this.closeInspection(false);
  }
  update(layout) { this.render(layout); }
  hide() {
    this.visible = false;
    this.root.hidden = true;
    clearTimeout(this.hoverTimer);
    this.resetRoom(null);
    this.layout = null;
  }
  destroy() {
    clearTimeout(this.hoverTimer);
    document.removeEventListener('keydown', this.keyListener);
    this.mediaQuery?.removeEventListener?.('change', this.mediaListener);
    this.a11y.destroy();
    this.root.remove();
    this.interaction.clear();
    this.layout = null;
    this.inspectionReturnFocus = null;
  }
}
