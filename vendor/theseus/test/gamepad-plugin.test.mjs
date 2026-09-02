import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

let gamepads = [];
const windowListeners = [];

const installBrowserLikeGlobals = () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
    writable: true
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: {},
      createElement: () => ({
        getContext: () => null,
        style: {}
      }),
      getElementById: () => null,
      getElementsByTagName: () => [],
      location: { href: 'http://localhost/' },
      readyState: 'complete'
    },
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => gamepads,
      maxTouchPoints: 0,
      userAgent: 'node'
    },
    writable: true
  });
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: { availHeight: 0, availWidth: 0 },
    writable: true
  });
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class Image {},
    writable: true
  });
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: class Audio {
      canPlayType() {
        return '';
      }
    },
    writable: true
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: class XMLHttpRequest {},
    writable: true
  });

  globalThis.addEventListener = (type, listener, useCapture) => {
    windowListeners.push({ type, listener, useCapture });
  };
};

installBrowserLikeGlobals();

const impactUrl = pathToFileURL(path.resolve('public/lib/impact/impact.js')).href;
const gamepadUrl =
  `${pathToFileURL(path.resolve('public/lib/plugins/gamepad.js')).href}?gamepad-test=${Date.now()}`;

const ig = (await import(impactUrl)).default;
await import(gamepadUrl);

const createButton = ({ pressed = false, value = pressed ? 1 : 0 } = {}) => ({
  pressed,
  value
});

const createGamepad = ({
  axes = [],
  buttons = {},
  connected = true,
  id = 'Test Gamepad',
  index = 0,
  mapping = 'standard'
} = {}) => {
  const gamepadButtons = Array.from({ length: 17 }, (_, buttonIndex) =>
    buttons[buttonIndex] || createButton()
  );
  const gamepadAxes = [0, 0, 0, 0];

  for (let i = 0; i < axes.length; i++) {
    gamepadAxes[i] = axes[i];
  }

  return {
    axes: gamepadAxes,
    buttons: gamepadButtons,
    connected,
    id,
    index,
    mapping
  };
};

const createInput = () => {
  const input = new ig.Input();
  windowListeners.length = 0;
  return input;
};

test('gamepad plugin removes legacy public numeric constants', () => {
  const legacyGamepadName = 'GAME' + 'PAD';
  const legacyOffsetName = legacyGamepadName + '_BUTTON_OFFSET';

  assert.equal(ig[legacyGamepadName], undefined);
  assert.equal(ig[legacyOffsetName], undefined);
});

test('browser indices auto-assign to logical slots in connection order', () => {
  gamepads = [
    createGamepad({ index: 3 }),
    createGamepad({ index: 0 })
  ];
  const input = createInput();

  input.bind('Gamepad0Left', 'p1Left');
  input.bind('Gamepad1Left', 'p2Left');

  assert.equal(input.gamepadIndexToSlot[3], 0);
  assert.equal(input.gamepadIndexToSlot[0], 1);
  assert.equal(input.gamepadSlots[0].index, 3);
  assert.equal(input.gamepadSlots[1].index, 0);
});

test('standard face-bottom button fires its logical-slot semantic code', () => {
  gamepads = [createGamepad({
    buttons: { 0: createButton({ pressed: true }) },
    index: 3
  })];
  const input = createInput();

  input.bind('Gamepad0FaceBottom', 'jump');
  input.pollGamepad();

  assert.equal(input.presses.jump, true);
  assert.equal(input.actions.jump, true);
});

test('disconnection releases active slot actions', () => {
  const gamepad = createGamepad({
    buttons: { 0: createButton({ pressed: true }) },
    index: 3
  });
  gamepads = [gamepad];
  const input = createInput();

  input.bind('Gamepad0FaceBottom', 'jump');
  input.pollGamepad();
  input.clearPressed();

  gamepads = [];
  input.pollGamepad();

  assert.equal(input.delayedKeyup.jump, true);
  assert.equal(input.gamepadSlots[0].connected, false);
  assert.equal(input.gamepadIndexToSlot[3], undefined);
});

test('same-signature reconnect reclaims the preserved logical slot', () => {
  gamepads = [createGamepad({ index: 3 })];
  const input = createInput();

  input.bind('Gamepad0Left', 'left');
  assert.equal(input.gamepadIndexToSlot[3], 0);

  gamepads = [];
  input.pollGamepad();
  assert.equal(input.gamepadSlots[0].connected, false);
  assert.equal(input.gamepadIndexToSlot[3], undefined);

  gamepads = [createGamepad({ index: 0 })];
  input.pollGamepad();

  assert.equal(input.gamepadIndexToSlot[0], 0);
  assert.equal(input.gamepadSlots[0].index, 0);
  assert.equal(input.gamepadSlots[0].connected, true);
});

test('manual join assigns a requested slot on join-button rising edge', () => {
  const gamepad = createGamepad({ index: 3 });
  gamepads = [gamepad];
  const input = createInput();
  input.gamepadAutoAssign = false;
  let joinedSlot = null;

  input.bind('Gamepad0FaceBottom', 'jump');
  input.onGamepadSlotJoined = (slot) => {
    joinedSlot = slot;
  };

  assert.equal(input.requestGamepadJoin(0), true);
  input.pollGamepad();
  assert.equal(input.gamepadSlots[0], undefined);

  gamepad.buttons[0] = createButton({ pressed: true });
  input.pollGamepad();

  assert.equal(joinedSlot, 0);
  assert.equal(input.gamepadIndexToSlot[3], 0);
  assert.equal(input.gamepadSlots[0].joined, true);
  assert.equal(input.presses.jump, undefined);
});

test('joined gamepads ignore gameplay input until released once', () => {
  const gamepad = createGamepad({ index: 3 });
  gamepads = [gamepad];
  const input = createInput();
  input.gamepadAutoAssign = false;

  input.bind('Gamepad0FaceBottom', 'jump');
  input.requestGamepadJoin(0);

  gamepad.buttons[0] = createButton({ pressed: true });
  input.pollGamepad();
  input.pollGamepad();
  assert.equal(input.presses.jump, undefined);

  gamepad.buttons[0] = createButton();
  input.pollGamepad();
  assert.equal(input.gamepadSlots[0].ignoreUntilReleased, false);

  gamepad.buttons[0] = createButton({ pressed: true });
  input.pollGamepad();
  assert.equal(input.presses.jump, true);
});
