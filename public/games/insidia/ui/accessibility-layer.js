/** Keyed semantic controls. An equivalent snapshot never replaces a focused node. */
export class AccessibilityLayer {
  constructor(root, interaction, changed = () => {}) {
    this.root = root;
    this.interaction = interaction;
    this.changed = changed;
    this.groups = new Map();
    this.announced = new Map();
    this.announcer = document.getElementById('game-announcer');
    this.summary = document.createElement('div');
    this.summary.className = 'premium-sr-only';
    this.summary.setAttribute('role', 'region');
    this.summary.setAttribute('aria-label', 'Resumen de la mesa');
    root.append(this.summary);
  }
  buttons(container, specs) {
    let group = this.groups.get(container);
    if (!group) this.groups.set(container, group = new Map());
    const keep = new Set(specs.map((spec) => spec.id));
    let removedFocus = false;
    for (const [id, entry] of group) {
      if (!keep.has(id)) {
        removedFocus ||= document.activeElement === entry.node;
        entry.node.remove();
        this.interaction.remove(id);
        group.delete(id);
      }
    }
    specs.forEach((spec, index) => {
      let entry = group.get(spec.id);
      if (!entry) {
        const node = document.createElement('button');
        node.type = 'button';
        entry = { node, spec, pointerScope: null };
        group.set(spec.id, entry);
        node.dataset.controlId = spec.id;
        const refresh = () => { this.decorate(entry); this.changed(); };
        node.addEventListener('pointerenter', () => {
          this.interaction.hovered = spec.id;
          entry.spec.onHover?.(true);
          refresh();
        });
        node.addEventListener('pointerleave', () => {
          if (this.interaction.hovered === spec.id) this.interaction.hovered = null;
          this.interaction.pressed = null;
          entry.spec.onHover?.(false);
          refresh();
        });
        node.addEventListener('focus', () => { this.interaction.focused = spec.id; refresh(); });
        node.addEventListener('blur', () => {
          if (this.interaction.focused === spec.id) this.interaction.focused = null;
          this.interaction.pressed = null;
          refresh();
        });
        node.addEventListener('pointerdown', () => {
          entry.pointerScope = entry.spec.scope;
          this.interaction.pressed = spec.id;
          refresh();
        });
        node.addEventListener('pointerup', () => { this.interaction.pressed = null; refresh(); });
        node.addEventListener('pointercancel', () => { entry.pointerScope = null; this.interaction.pressed = null; refresh(); });
        node.addEventListener('keydown', (event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            entry.pointerScope = null;
            this.interaction.pressed = spec.id;
            refresh();
          }
        });
        node.addEventListener('keyup', () => { this.interaction.pressed = null; refresh(); });
        node.addEventListener('click', (event) => {
          const staleGesture = event.detail > 0 && entry.pointerScope !== null && entry.pointerScope !== entry.spec.scope;
          entry.pointerScope = null;
          if (entry.spec.disabled || staleGesture) return;
          entry.spec.activate?.();
          refresh();
        });
      }
      entry.spec = spec;
      const { node } = entry;
      const label = spec.pending ? 'Enviando…' : spec.label;
      if (node.textContent !== label) node.textContent = label;
      node.disabled = !!spec.disabled;
      node.title = spec.reason ?? '';
      node.setAttribute('aria-label', spec.ariaLabel ?? `${spec.label}${spec.reason ? `. ${spec.reason}` : ''}`);
      node.setAttribute('aria-disabled', String(!!spec.disabled));
      if (spec.selected !== undefined) node.setAttribute('aria-pressed', String(!!spec.selected));
      else node.removeAttribute('aria-pressed');
      if (spec.expanded !== undefined) node.setAttribute('aria-expanded', String(spec.expanded));
      else node.removeAttribute('aria-expanded');
      node.setAttribute('aria-busy', String(!!spec.pending));
      if (spec.bounds) {
        const { x, y, w, h } = spec.bounds;
        node.style.left = `${x}px`; node.style.top = `${y}px`;
        node.style.width = `${w}px`; node.style.height = `${h}px`;
      }
      this.interaction.set(spec.id, { disabled: !!spec.disabled, selected: !!spec.selected, invalid: !!spec.invalid });
      this.decorate(entry);
      // Insert only if ordering changed; appendChild on every frame can lose focus.
      if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
    });
    return removedFocus;
  }
  decorate(entry) {
    const state = this.interaction.state(entry.spec.id);
    entry.node.className = `premium-button ${entry.spec.className ?? ''}`;
    entry.node.dataset.state = state.state;
    entry.node.dataset.selected = String(state.selected);
    entry.node.dataset.focused = String(state.focused);
  }
  announce(key, message) {
    if (!message || this.announced.get(key) === message) return;
    this.announced.set(key, message);
    if (this.announced.size > 200) this.announced.delete(this.announced.keys().next().value);
    if (this.announcer) this.announcer.textContent = message;
  }
  setSummary(text) { if (this.summary.textContent !== text) this.summary.textContent = text; }
  reset() {
    for (const [container] of this.groups) this.buttons(container, []);
    this.groups.clear();
    this.announced.clear();
    this.summary.textContent = '';
  }
  destroy() { this.reset(); this.summary.remove(); }
}
