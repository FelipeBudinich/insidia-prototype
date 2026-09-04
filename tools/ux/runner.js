import { ClientStore } from '/games/insidia/state/client-store.js';
import { BoardRenderer } from '/games/insidia/ui/board-renderer.js';
import { HomeScene } from '/games/insidia/scenes/home-scene.js';
import { assets } from '/games/insidia/media/assets.js';

const dataset = await (await fetch('/tools/ux/fixtures.json')).json();
const stage = document.getElementById('stage'), canvas = document.getElementById('canvas');
const status = document.getElementById('fixture-status'), selector = document.getElementById('sequence');
let elapsed = 0, wall = 0, store, board, home, sequence, index = 0, playing = false, lastTime, disconnectedSnapshot = null;
for (const item of dataset.sequences) {
  const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; selector.append(option);
}
async function image(path) {
  const data = new Image(); data.src = '/' + path.replace(/^\//, '');
  await data.decode();
  return { data, loaded: true, width: data.naturalWidth, height: data.naturalHeight,
    getSourceRect: (x, y, width, height) => ({ x, y, width, height }) };
}
const loadedAssets = {};
for (const [key, value] of Object.entries(assets)) {
  if (value.path) loadedAssets[key] = Object.assign(value, await image(value.path));
  else loadedAssets[key] = Object.fromEntries(await Promise.all(Object.entries(value).map(async ([id, entry]) => [id, Object.assign(entry, await image(entry.path))])));
}
function resize() {
  const width = stage.clientWidth, height = stage.clientHeight, scale = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  board?.resize(width, height);
}
function next() {
  if (disconnectedSnapshot || index >= sequence.frames.length) { playing = false; return; }
  const frame = structuredClone(sequence.frames[index++]);
  store.apply(frame.snapshot); store.presentation.update(); board.update();
}
function reset() {
  board?.destroy(); store?.presentation.destroy();
  sequence = dataset.sequences.find((item) => item.id === selector.value) ?? dataset.sequences[0];
  elapsed = 0; index = 0; playing = false; disconnectedSnapshot = null;
  document.getElementById('reconnect').textContent = 'Desconectar';
  wall = Date.parse(sequence.frames[0].snapshot.serverTime);
  store = new ClientStore({ now: () => elapsed, wallNow: () => wall });
  const dispatch = { send() { status.textContent = 'Ensayo sin red: usa Un snapshot para avanzar la autoridad.'; return false; } };
  home = new HomeScene(store, dispatch);
  board = new BoardRenderer(store, dispatch, home, loadedAssets);
  store.apply({ kind: 'sessionReady', projectionEpoch: sequence.frames[0].snapshot.projectionEpoch, serverTime: sequence.frames[0].snapshot.serverTime, resumableRoomId: sequence.frames[0].snapshot.roomId });
  resize(); next();
}
selector.onchange = reset;
document.getElementById('reset').onclick = reset;
document.getElementById('play').onclick = () => { if (!disconnectedSnapshot) playing = !playing; };
document.getElementById('step').onclick = next;
document.getElementById('hide').onclick = () => store.presentation.setHidden(!store.presentation.hidden);
document.getElementById('reconnect').onclick = () => {
  if (!disconnectedSnapshot) {
    disconnectedSnapshot = structuredClone(store.view);
    store.clearConnection();
    playing = false;
    document.getElementById('reconnect').textContent = 'Restaurar conexión';
    board.update();
    return;
  }
  const latest = disconnectedSnapshot;
  disconnectedSnapshot = null;
  document.getElementById('reconnect').textContent = 'Desconectar';
  const epoch = crypto.randomUUID();
  store.apply({ kind: 'sessionReady', projectionEpoch: epoch, resumableRoomId: latest.roomId, serverTime: latest.serverTime });
  latest.projectionEpoch = epoch; latest.projectionRevision = '1';
  store.apply(latest);
  // Continue the synthetic sequence in the new controlling epoch.
  sequence = structuredClone(sequence);
  sequence.frames.forEach((frame, ordinal) => { frame.snapshot.projectionEpoch = epoch; frame.snapshot.projectionRevision = String(ordinal + 2); });
};
document.getElementById('gap').onclick = () => {
  if (!disconnectedSnapshot) { index = sequence.frames.length - 1; next(); }
};
window.addEventListener('resize', resize);
reset();
function draw(time) {
  const delta = Math.min(100, time - (lastTime ?? time)); lastTime = time;
  if (playing) elapsed += delta * Number(document.getElementById('speed').value);
  if (playing) while (index < sequence.frames.length && sequence.frames[index].at <= elapsed) next();
  if (index === sequence.frames.length && elapsed > sequence.frames.at(-1).at + 2500) playing = false;
  store.presentation.update(); home.syncRules(); board.update();
  const scale = canvas.width / stage.clientWidth, context = canvas.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, stage.clientWidth, stage.clientHeight); board.draw(context); store.presentation.markRevealsReady();
  document.getElementById('play').textContent = playing ? 'Pausar' : 'Reproducir';
  const metrics = store.presentation.metrics;
  status.textContent = `${index}/${sequence.frames.length} · ${sequence.frames[Math.max(0, index - 1)].label} · cues ${store.presentation.cues.length} · cola ${Math.round(metrics.presentationBacklogMs)} ms · reconciliaciones ${metrics.reconciliations} · huecos ${metrics.historyGaps}`;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
