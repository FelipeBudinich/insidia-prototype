import ig from '../../../lib/impact/impact.js';

// Load the existing atlas/resources once. Missing art is represented by the
// readable renderer fallback and cannot prevent a match from starting.
export const InsidiaLoader = ig.Loader.extend({
  draw() {
    const progress = document.getElementById('boot-progress');
    if (progress) { progress.value = this.status; progress.textContent = `${Math.round(this.status * 100)}%`; }
  },
  _loadCallback(path, loaded) {
    this._unloaded = this._unloaded.filter(item => item !== path);
    this.status = this.resources.length ? 1 - this._unloaded.length / this.resources.length : 1;
    if (!loaded) {
      const label = document.getElementById('boot-status');
      if (label) label.textContent = 'Preparando la mesa con ilustraciones de reserva…';
    }
    if (!this._unloaded.length) this.end();
  },
  end() {
    if (this.done || this.waitingFonts) return;
    this.waitingFonts = true;
    Promise.resolve(document.fonts?.ready).catch(() => {}).then(() => {
      this.waitingFonts = false;
      if (this.done) return;
      this.done = true;
      clearInterval(this._intervalId);
      document.getElementById('boot')?.remove();
      ig.system.setGame(this.gameClass);
    });
  },
});
