import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ensureGlobal = (name, value) => {
  if (globalThis[name] === undefined) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true
    });
  }
};

const installBrowserLikeGlobals = () => {
  ensureGlobal('window', globalThis);
  ensureGlobal('document', {
    body: {},
    createElement: () => ({
      getContext: () => null,
      style: {}
    }),
    getElementById: () => null,
    getElementsByTagName: () => [],
    location: { href: 'http://localhost/' },
    readyState: 'complete'
  });
  ensureGlobal('navigator', { maxTouchPoints: 0, userAgent: 'node' });
  ensureGlobal('screen', { availHeight: 0, availWidth: 0 });
  ensureGlobal('Image', class Image {});
  ensureGlobal('Audio', class Audio {
    canPlayType() {
      return '';
    }
  });
  ensureGlobal('XMLHttpRequest', class XMLHttpRequest {});
};

installBrowserLikeGlobals();

const moduleUrl =
  `${pathToFileURL(path.resolve('public/lib/impact/impact.js')).href}?input-test=${Date.now()}`;
const ig = (await import(moduleUrl)).default;

const createEventTarget = () => {
  const listeners = [];

  return {
    listeners,
    addEventListener(type, listener, useCapture) {
      listeners.push({ type, listener, useCapture });
    }
  };
};

const createEvent = (overrides = {}) => ({
  defaultPrevented: false,
  propagationStopped: false,
  target: { tagName: 'CANVAS' },

  preventDefault() {
    this.defaultPrevented = true;
  },

  stopPropagation() {
    this.propagationStopped = true;
  },

  ...overrides
});

const createInputHarness = () => {
  const windowTarget = createEventTarget();
  const canvas = {
    ...createEventTarget(),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    offsetWidth: 320,
    style: {}
  };

  window.addEventListener = windowTarget.addEventListener.bind(windowTarget);
  window.focus = () => {
    windowTarget.focused = true;
  };

  ig.system = {
    canvas,
    realWidth: 320,
    scale: 1
  };
  ig.ua.mobile = false;
  ig.ua.touchDevice = false;

  return {
    canvas,
    input: new ig.Input(),
    windowTarget
  };
};

test('keyboard string binds initialize keyboard listeners', () => {
  const { input, windowTarget } = createInputHarness();

  input.bind('KeyX', 'jump');

  assert.equal(input.bindings.KeyX, 'jump');
  assert.equal(input.isUsingKeyboard, true);
  assert.equal(input.isUsingMouse, false);
  assert.deepEqual(windowTarget.listeners.map((event) => event.type), ['keydown', 'keyup']);
});

test('mouse and wheel string binds initialize mouse listeners', () => {
  const { canvas, input } = createInputHarness();

  input.bind('MousePrimary', 'shoot');
  input.bind('WheelUp', 'zoomIn');

  assert.equal(input.bindings.MousePrimary, 'shoot');
  assert.equal(input.bindings.WheelUp, 'zoomIn');
  assert.equal(input.isUsingMouse, true);
  assert.equal(input.isUsingKeyboard, false);
  assert.deepEqual(
    canvas.listeners.map((event) => event.type),
    ['wheel', 'contextmenu', 'mousedown', 'mouseup', 'mousemove']
  );
});

test('gamepad string binds initialize gamepad listeners when available', () => {
  const { input } = createInputHarness();
  var initGamepadCalls = 0;

  input.initGamepad = function() {
    initGamepadCalls++;
    this.isUsingGamepad = true;
  };

  input.bind('Gamepad0Left', 'left');

  assert.equal(input.bindings.Gamepad0Left, 'left');
  assert.equal(initGamepadCalls, 1);
  assert.equal(input.isUsingGamepad, true);
  assert.equal(input.isUsingKeyboard, false);
  assert.equal(input.isUsingMouse, false);
});

test('generic gamepad binds are rejected', () => {
  const { input } = createInputHarness();
  var initGamepadCalls = 0;

  input.initGamepad = function() {
    initGamepadCalls++;
    this.isUsingGamepad = true;
  };

  for (const key of ['GamepadLeft', 'GamepadFaceBottom']) {
    assert.throws(
      () => input.bind(key, 'action'),
      {
        name: 'Error',
        message: 'Gamepad bindings must include a controller slot, e.g. Gamepad0Left'
      }
    );
    assert.equal(input.bindings[key], undefined);
  }

  assert.equal(initGamepadCalls, 0);
  assert.equal(input.isUsingKeyboard, false);
  assert.equal(input.isUsingMouse, false);
});

test('indexed gamepad binds require the gamepad plugin', () => {
  const { input } = createInputHarness();

  assert.throws(
    () => input.bind('Gamepad0Left', 'left'),
    {
      name: 'Error',
      message: 'Gamepad plugin is not loaded'
    }
  );
  assert.equal(input.bindings.Gamepad0Left, undefined);
  assert.equal(input.isUsingKeyboard, false);
  assert.equal(input.isUsingMouse, false);
});

test('numeric binds are rejected', () => {
  const { input } = createInputHarness();

  assert.throws(
    () => input.bind(256, 'jump'),
    {
      name: 'TypeError',
      message: 'ig.Input.bind() expects key to be a string'
    }
  );
  assert.equal(input.bindings[256], undefined);
});

test('keyboard input uses KeyboardEvent.code', () => {
  const { input } = createInputHarness();
  const event = createEvent({
    code: 'KeyX',
    type: 'keydown'
  });

  input.bind('KeyX', 'jump');
  input.keydown(event);

  assert.equal(input.actions.jump, true);
  assert.equal(input.presses.jump, true);
  assert.equal(input.bindings[67], undefined);
  assert.equal(event.defaultPrevented, true);
});

test('mouseInputCode translates mouse and touch events to string codes', () => {
  const { input } = createInputHarness();

  assert.equal(input.mouseInputCode({ button: 0, type: 'mousedown' }), 'MousePrimary');
  assert.equal(input.mouseInputCode({ button: 1, type: 'mousedown' }), 'MouseAuxiliary');
  assert.equal(input.mouseInputCode({ button: 2, type: 'mousedown' }), 'MouseSecondary');
  assert.equal(input.mouseInputCode({ button: 3, type: 'mousedown' }), 'MouseBack');
  assert.equal(input.mouseInputCode({ button: 4, type: 'mousedown' }), 'MouseForward');
  assert.equal(input.mouseInputCode({ type: 'touchstart' }), 'MousePrimary');
});

test('wheel direction maps to WheelUp and WheelDown', () => {
  const { input } = createInputHarness();
  const wheelUp = createEvent({ deltaY: -1 });
  const wheelDown = createEvent({ deltaY: 1 });

  input.bind('WheelUp', 'zoomIn');
  input.bind('WheelDown', 'zoomOut');

  input.mousewheel(wheelUp);
  assert.equal(input.presses.zoomIn, true);
  assert.equal(input.delayedKeyup.zoomIn, true);
  assert.equal(wheelUp.defaultPrevented, true);
  assert.equal(wheelUp.propagationStopped, true);

  input.clearPressed();
  input.mousewheel(wheelDown);
  assert.equal(input.presses.zoomOut, true);
  assert.equal(input.delayedKeyup.zoomOut, true);
  assert.equal(wheelDown.defaultPrevented, true);
  assert.equal(wheelDown.propagationStopped, true);
});
