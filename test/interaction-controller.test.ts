import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractionController, currentLegalAction, validPromptAnswer, activeNeighbor, decisionIdentity } from '../public/games/insidia/ui/interaction-controller.js';

const store = () => ({ connected: true, pending: new Map(), now: () => 1000,
  view: { roomId: 'room', public: { room: { status: 'active' }, turn: { deadline: new Date(2000).toISOString() } }, self: {
    legalActions: [{ type: 'game.declareSin', opportunityId: 'current', allowedSins: ['GULA'] }], hand: [],
  } },
});

test('activation revalidates current opportunity, deadline, connection and command lock', () => {
  const fixture = store();
  assert.equal(currentLegalAction(fixture, 'game.declareSin', 'current')?.type, 'game.declareSin');
  assert.equal(currentLegalAction(fixture, 'game.declareSin', 'obsolete'), null);
  fixture.now = () => 2000;
  assert.equal(currentLegalAction(fixture, 'game.declareSin', 'current'), null);
  fixture.now = () => 1000;
  fixture.connected = false;
  assert.equal(currentLegalAction(fixture, 'game.declareSin', 'current'), null);
  fixture.connected = true;
  fixture.pending.set('receipt', {});
  assert.equal(currentLegalAction(fixture, 'game.declareSin', 'current'), null);
});

test('sealed Herejía state invalidates a formerly legal answer at equal state version', () => {
  const fixture: any = store();
  fixture.view.self.legalActions = [{ type: 'game.answerPrompt', promptId: 'private' }];
  fixture.view.self.prompt = { kind: 'selectHerejiaCard', promptId: 'private', submitted: false, eligibleHandCardRefs: ['own'] };
  fixture.view.self.hand = [{ handCardRef: 'own', sin: 'GULA' }];
  const oldIdentity = decisionIdentity(fixture.view);
  assert.ok(currentLegalAction(fixture, 'game.answerPrompt', 'private'));
  fixture.view.self.prompt.submitted = true;
  assert.equal(decisionIdentity(fixture.view), oldIdentity);
  assert.equal(currentLegalAction(fixture, 'game.answerPrompt', 'private'), null);
  assert.equal(validPromptAnswer(fixture.view.self.prompt, { kind: 'selectHerejiaCard', handCardRef: 'own' }, fixture.view.self.hand), false);
});

test('Envidia preserves explicit order but rejects duplicate and departed card references', () => {
  const prompt = { kind: 'selectCards', count: 2, ordered: true, eligibleHandCardRefs: ['a', 'b', 'c'] };
  const hand = [{ handCardRef: 'a' }, { handCardRef: 'b' }];
  assert.equal(validPromptAnswer(prompt, { kind: 'selectCards', handCardRefs: ['b', 'a'] }, hand), true);
  assert.equal(validPromptAnswer(prompt, { kind: 'selectCards', handCardRefs: ['a', 'a'] }, hand), false);
  assert.equal(validPromptAnswer(prompt, { kind: 'selectCards', handCardRefs: ['a', 'c'] }, hand), false);
  assert.equal(validPromptAnswer(prompt, { kind: 'selectCards', handCardRefs: ['a'] }, hand), false);
});

test('direction and payment choices are only those included by authority', () => {
  assert.equal(validPromptAnswer({ kind: 'selectPayment', options: ['discard'] }, { kind: 'selectPayment', choice: 'pay' }), false);
  assert.equal(validPromptAnswer({ kind: 'selectDirection', options: ['right'] }, { kind: 'selectDirection', direction: 'right' }), true);
  assert.equal(validPromptAnswer({ kind: 'selectDirection', options: ['right'] }, { kind: 'selectDirection', direction: 'left' }), false);
});

test('Herejía recipients use clockwise stored seats and skip eliminated neighbors', () => {
  const players = [{ playerId: 'c', seatIndex: 2, status: 'active' }, { playerId: 'a', seatIndex: 0, status: 'active' }, { playerId: 'b', seatIndex: 1, status: 'eliminated' }, { playerId: 'd', seatIndex: 3, status: 'active' }];
  assert.equal(activeNeighbor(players, 'a', 'right')?.playerId, 'c');
  assert.equal(activeNeighbor(players, 'a', 'left')?.playerId, 'd');
  assert.equal(activeNeighbor(players, 'd', 'right')?.playerId, 'a');
});

test('pointer, keyboard, selected and pending states share a removable model', () => {
  const controller = new InteractionController();
  controller.set('card:a', { selected: true });
  controller.hovered = 'card:a';
  assert.equal(controller.state('card:a').selected, true);
  assert.equal(controller.state('card:a').hovered, true);
  controller.focused = 'card:a';
  controller.pressed = 'card:a';
  assert.equal(controller.state('card:a').state, 'pressed');
  controller.pending = 'card:a';
  assert.equal(controller.state('card:a').state, 'pending');
  controller.remove('card:a');
  assert.equal(controller.state('card:a').state, 'idle');
  assert.equal(controller.focused, null);
});
