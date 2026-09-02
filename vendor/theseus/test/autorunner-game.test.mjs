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
		location: { href: 'http://localhost/', search: '' },
		readyState: 'complete'
	});
	ensureGlobal('navigator', { maxTouchPoints: 0, userAgent: 'node' });
	ensureGlobal('screen', { availHeight: 0, availWidth: 0 });
	ensureGlobal('Image', class Image {});
	ensureGlobal('Audio', class Audio {
		canPlayType() {
			return '';
		}

		play() {
			return { catch() {} };
		}
	});
	ensureGlobal('XMLHttpRequest', class XMLHttpRequest {});
};

const moduleUrl = (relativePath) =>
	pathToFileURL(path.resolve(relativePath)).href;

const getLayer = (level, name) =>
	level.layer.find((layer) => layer.name === name);

const getLevelChangeTarget = (level) =>
	level.entities.find((entity) => entity.type === 'EntityLevelchange')?.settings?.level;

const getSpawnPointEntity = (level, index = 0) =>
	level.entities.find((entity) => {
		if (entity.type !== 'EntitySpawnPoint') {
			return false;
		}

		return Number(entity.settings?.index || 0) === index;
	});

const getOnlyRunnerEnter = (game) => {
	const enters = game.getEntitiesByType('EntityRunnerEnter');
	assert.equal(enters.length, 1);
	return enters[0];
};

const updateUntilRunnerSpawns = (game, maxSteps = 180) => {
	for (let step = 0; step < maxSteps; step++) {
		const runner = game.getEntitiesByType('EntityRunner')[0];
		if (runner) {
			return runner;
		}

		game.update();
	}

	return game.getEntitiesByType('EntityRunner')[0] || null;
};

test('autorunner registers a start to middle to end level chain', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { LevelStart } = await import(moduleUrl('public/games/001-autorunner/levels/start.js'));
	const { LevelMiddle } = await import(moduleUrl('public/games/001-autorunner/levels/middle.js'));
	const { LevelEnd } = await import(moduleUrl('public/games/001-autorunner/levels/end.js'));

	assert.equal(getLevelChangeTarget(LevelStart), 'middle');
	assert.equal(getLevelChangeTarget(LevelMiddle), 'end');
	assert.equal(getLevelChangeTarget(LevelEnd), 'start');
	assert.equal(ig.Game.getLevelByName('start'), LevelStart);
	assert.equal(ig.Game.getLevelByName('middle'), LevelMiddle);
	assert.equal(ig.Game.getLevelByName('end'), LevelEnd);
});

test('autorunner restarts in the level where the player lost', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { AutorunnerGame } = await import(moduleUrl('public/games/001-autorunner/game.js'));
	const { LevelStart } = await import(moduleUrl('public/games/001-autorunner/levels/start.js'));
	const { LevelMiddle } = await import(moduleUrl('public/games/001-autorunner/levels/middle.js'));
	const { LevelEnd } = await import(moduleUrl('public/games/001-autorunner/levels/end.js'));

	ig.system = {
		clear() {},
		context: { globalAlpha: 1 },
		tick: 1 / 60
	};
	ig.input = {
		bind() {},
		pressed() {
			return false;
		}
	};

	const game = new AutorunnerGame();
	assert.equal(game.currentLevel, LevelStart);
	assert.equal(game.getEntitiesByType('EntityRunner').length, 0);
	let runnerEnter = getOnlyRunnerEnter(game);
	assert.equal(runnerEnter.pos.x, getSpawnPointEntity(LevelStart).x);
	assert.equal(runnerEnter.pos.y + runnerEnter.size.y < game.screen.y, true);

	game.loadLevel(LevelMiddle);
	assert.equal(game.currentLevel, LevelMiddle);
	assert.equal(game.getEntitiesByType('EntityRunner').length, 0);
	runnerEnter = getOnlyRunnerEnter(game);
	assert.equal(runnerEnter.pos.x, getSpawnPointEntity(LevelMiddle).x);
	assert.equal(runnerEnter.pos.y + runnerEnter.size.y < game.screen.y, true);
	assert.equal(game.collisionMap.data, getLayer(LevelMiddle, 'collision').data);

	game.loadLevelDeferred(LevelEnd);
	game.lose();
	game.update();
	game.restart();

	assert.equal(game.currentLevel, LevelMiddle);
	assert.equal(game.state, 'playing');
	assert.equal(game.collisionMap.data, getLayer(LevelMiddle, 'collision').data);
	assert.equal(game.getEntitiesByType('EntityRunner').length, 0);
	assert.equal(getOnlyRunnerEnter(game).pos.x, getSpawnPointEntity(LevelMiddle).x);
});

test('runner kill spawns a rotating dead runner at the runner position', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { AutorunnerGame } = await import(moduleUrl('public/games/001-autorunner/game.js'));
	const { EntityRunnerDead } = await import(moduleUrl('public/games/001-autorunner/entities/runner-dead.js'));

	ig.system = {
		clear() {},
		context: { globalAlpha: 1 },
		tick: 1 / 60
	};
	ig.input = {
		bind() {},
		pressed() {
			return false;
		}
	};

	const game = new AutorunnerGame();
	const runner = updateUntilRunnerSpawns(game);
	assert.ok(runner);
	const runnerPos = {x: runner.pos.x, y: runner.pos.y};
	const runnerVelX = runner.vel.x;
	const runnerAngle = Math.PI / 4;

	runner.currentAnim.angle = runnerAngle;
	runner.kill();

	const deadRunners = game.getEntitiesByType(EntityRunnerDead);
	assert.equal(deadRunners.length, 1);

	const deadRunner = deadRunners[0];
	assert.equal(deadRunner.pos.x, runnerPos.x);
	assert.equal(deadRunner.pos.y, runnerPos.y);
	assert.equal(deadRunner.vel.x, runnerVelX);
	assert.equal(deadRunner.vel.y, -200);
	assert.equal(deadRunner.animSheet.image.path, runner.animSheet.image.path);
	assert.equal(deadRunner.animSheet.width, runner.animSheet.width);
	assert.equal(deadRunner.animSheet.height, runner.animSheet.height);
	assert.deepEqual(deadRunner.currentAnim.sequence, [0]);
	assert.equal(deadRunner.currentAnim.tile, 0);
	assert.equal(deadRunner.currentAnim.angle, runnerAngle);
	assert.equal(game.state, 'lost');
	assert.equal(game.runner, null);

	deadRunner.update();
	assert.equal(deadRunner.currentAnim.angle > runnerAngle, true);
	assert.equal(deadRunner.pos.y < runnerPos.y, true);

	const launchAngle = deadRunner.currentAnim.angle;
	game.collisionMap = ig.CollisionMap.staticNoCollision;
	for (let step = 0; step < 30; step++) {
		deadRunner.update();
	}

	assert.equal(deadRunner.currentAnim.angle > launchAngle, true);
	assert.equal(deadRunner.vel.y > 0, true);
	assert.equal(deadRunner.pos.y > runnerPos.y, true);
});

test('dead runner stops tracing collision tiles after its first tile hit', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { EntityRunnerDead } = await import(moduleUrl('public/games/001-autorunner/entities/runner-dead.js'));
	const collisionMap = new ig.CollisionMap(16, [
		[0],
		[1]
	]);
	const originalTrace = collisionMap.trace.bind(collisionMap);
	let traceCalls = 0;

	collisionMap.trace = function(...args) {
		traceCalls++;
		return originalTrace(...args);
	};

	ig.system = {
		context: { globalAlpha: 1 },
		height: 64,
		tick: 1 / 60,
		width: 100
	};
	ig.game = {
		_rscreen: {x: 0, y: 0},
		collisionMap,
		gravity: 982,
		removeEntity() {}
	};

	const deadRunner = new EntityRunnerDead(4, 0, {});
	deadRunner.vel.x = 0;
	deadRunner.vel.y = 220;

	deadRunner.update();
	assert.equal(traceCalls, 1);
	assert.equal(deadRunner.ignoreCollisionTiles, true);
	assert.equal(deadRunner.standing, false);
	assert.equal(deadRunner.pos.y, 1);
	assert.equal(deadRunner.vel.y, 0);

	deadRunner.update();
	assert.equal(traceCalls, 1);
	assert.equal(deadRunner.vel.y > 0, true);
	assert.equal(deadRunner.pos.y > 1, true);

	for (let step = 0; step < 60; step++) {
		deadRunner.update();
	}

	assert.equal(traceCalls, 1);
	assert.equal(deadRunner.pos.y > ig.system.height, true);
});

test('kill trigger extends trigger and kills the runner that touches it', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { AutorunnerGame } = await import(moduleUrl('public/games/001-autorunner/game.js'));
	const { EntityKillTrigger } = await import(moduleUrl('public/games/001-autorunner/entities/kill-trigger.js'));

	ig.system = {
		clear() {},
		context: { globalAlpha: 1 },
		tick: 1 / 60
	};
	ig.input = {
		bind() {},
		pressed() {
			return false;
		}
	};

	const game = new AutorunnerGame();
	const runner = updateUntilRunnerSpawns(game);
	assert.ok(runner);
	const killTrigger = game.spawnEntity(EntityKillTrigger, runner.pos.x, runner.pos.y, {
		size: {x: 16, y: 16}
	});

	assert.equal(killTrigger instanceof ig.EntityTrigger, true);
	assert.equal(killTrigger._wmScalable, true);
	assert.equal(killTrigger.checkAgainst, ig.Entity.TYPE.A);
	assert.equal(killTrigger.collides, ig.Entity.COLLIDES.NEVER);

	game.checkEntities();

	assert.equal(runner._killed, true);
	assert.equal(game.state, 'lost');
	assert.equal(game.runner, null);
	assert.equal(game.getEntitiesByType('EntityRunnerDead').length, 1);
});

test('autorunner dust uses the seven-frame dust animation sheet', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { EntityDust } = await import(moduleUrl('public/games/001-autorunner/entities/dust.js'));

	ig.system = {
		context: { globalAlpha: 1 },
		getDrawPos(value) {
			return value;
		},
		height: 100,
		scale: 1,
		tick: 1 / 60,
		width: 100
	};
	ig.game = {
		_rscreen: {x: 0, y: 0},
		screen: {x: 0, y: 0},
		removeEntity(entity) {
			entity._killed = true;
		}
	};

	const dust = new EntityDust(12, 20, {
		life: 0.35,
		size: {x: 3, y: 4},
		vel: {x: 5, y: -2}
	});

	assert.equal(ig.getClass('EntityDust'), EntityDust);
	assert.equal(dust.animSheet.image.path, 'games/001-autorunner/media/dust.png');
	assert.equal(dust.animSheet.width, 16);
	assert.equal(dust.animSheet.height, 16);
	assert.deepEqual(dust.size, {x: 16, y: 16});
	assert.deepEqual(dust.currentAnim.sequence, [0, 1, 2, 3, 4, 5, 6]);
	assert.equal(dust.currentAnim.stop, true);
	assert.equal(dust.currentAnim.frameTime, dust.life / 7);

	dust.update();

	assert.equal(dust.pos.x > 12, true);
	assert.equal(dust.currentAnim.alpha, 1);
	dust.draw();
	assert.equal(dust.currentAnim.alpha < 1, true);
});

test('runner spawns dust opposite to half of its current velocity', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { AutorunnerGame } = await import(moduleUrl('public/games/001-autorunner/game.js'));

	ig.system = {
		clear() {},
		context: { globalAlpha: 1 },
		tick: 1 / 60
	};
	ig.input = {
		bind() {},
		pressed() {
			return false;
		},
		released() {
			return false;
		},
		state() {
			return false;
		}
	};

	const game = new AutorunnerGame();
	const runner = updateUntilRunnerSpawns(game);
	assert.ok(runner);

	runner.vel.x = 240;
	runner.vel.y = -160;
	runner.spawnDust(3, 12);

	const dust = game.getEntitiesByType('EntityDust');
	assert.equal(dust.length, 3);
	for (const particle of dust) {
		assert.equal(particle.vel.x, -120);
		assert.equal(particle.vel.y, 80);
	}
});

test('spawn point sets the active checkpoint and respawns the runner there after death', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { AutorunnerGame } = await import(moduleUrl('public/games/001-autorunner/game.js'));
	const { EntityRunnerEnter } = await import(moduleUrl('public/games/001-autorunner/entities/runner-enter.js'));
	const { EntitySpawnPoint } = await import(moduleUrl('public/games/001-autorunner/entities/spawn-point.js'));
	const emptyRow = Array(40).fill(0);
	const solidRow = Array(40).fill(1);
	const checkpointLevel = {
		entities: [
			{
				type: 'EntitySpawnPoint',
				x: 120,
				y: 177,
				settings: {
					index: 0,
					size: {x: 16, y: 16}
				}
			},
			{
				type: 'EntitySpawnPoint',
				x: 320,
				y: 177,
				settings: {
					index: '1',
					size: {x: 16, y: 16}
				}
			}
		],
		layer: [
			{
				name: 'collision',
				tilesize: 16,
				data: [
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					emptyRow,
					solidRow
				]
			}
		]
	};

	ig.system = {
		clear() {},
		context: { globalAlpha: 1 },
		tick: 1 / 60
	};
	ig.input = {
		bind() {},
		pressed() {
			return false;
		}
	};

	const game = new AutorunnerGame();
	ig.spawnPoint = 1;
	game.loadLevel(checkpointLevel);

	const spawnPoints = game.getEntitiesByType(EntitySpawnPoint);
	const firstSpawnPoint = spawnPoints.find((spawnPoint) => spawnPoint.index === 0);
	const checkpoint = spawnPoints.find((spawnPoint) => spawnPoint.index === '1');
	let runnerEnter = game.getEntitiesByType(EntityRunnerEnter)[0];

	assert.equal(EntitySpawnPoint.prototype instanceof ig.EntityTrigger, true);
	assert.equal(checkpoint instanceof ig.EntityTrigger, true);
	assert.equal(checkpoint._wmScalable, true);
	assert.equal(checkpoint.checkAgainst, ig.Entity.TYPE.A);
	assert.equal(checkpoint.collides, ig.Entity.COLLIDES.NEVER);
	assert.equal(ig.spawnPoint, 0);
	assert.equal(game.getEntitiesByType('EntityRunner').length, 0);
	assert.equal(runnerEnter.pos.x, firstSpawnPoint.pos.x);
	assert.equal(runnerEnter.pos.y + runnerEnter.size.y < game.screen.y, true);
	assert.equal(runnerEnter.spinSpeed, 18);

	const enterAngle = runnerEnter.currentAnim.angle;
	runnerEnter.update();
	assert.equal(runnerEnter.pos.x, firstSpawnPoint.pos.x);
	assert.equal(runnerEnter.currentAnim.angle > enterAngle, true);

	let runner = updateUntilRunnerSpawns(game);
	assert.ok(runner);
	assert.equal(game.getEntitiesByType(EntityRunnerEnter).length, 0);
	assert.equal(runner.pos.x, firstSpawnPoint.pos.x);
	assert.equal(runner.pos.y, firstSpawnPoint.pos.y);

	runner.pos.x = checkpoint.pos.x;
	runner.pos.y = checkpoint.pos.y;
	game.checkEntities();
	assert.equal(ig.spawnPoint, 1);

	runner.kill();
	game.restart();

	assert.equal(ig.spawnPoint, 1);
	assert.equal(game.getEntitiesByType('EntityRunner').length, 0);
	runnerEnter = game.getEntitiesByType(EntityRunnerEnter)[0];
	assert.equal(runnerEnter.pos.x, checkpoint.pos.x);
	assert.equal(runnerEnter.pos.y + runnerEnter.size.y < game.screen.y, true);

	runner = updateUntilRunnerSpawns(game);
	assert.ok(runner);
	assert.equal(runner.pos.x, checkpoint.pos.x);
	assert.equal(runner.pos.y, checkpoint.pos.y);
	assert.equal(game.state, 'playing');
});

test('autorunner spikes register as a scalable runner hazard and repeat when drawn', async () => {
	installBrowserLikeGlobals();

	const ig = (await import(moduleUrl('public/lib/impact/impact.js'))).default;
	const { EntitySpikes } = await import(moduleUrl('public/games/001-autorunner/entities/spikes.js'));
	const drawCalls = [];
	const transformCalls = [];

	ig.system = {
		context: {
			save() {
				transformCalls.push(['save']);
			},
			restore() {
				transformCalls.push(['restore']);
			},
			rotate(angle) {
				transformCalls.push(['rotate', angle]);
			},
			translate(x, y) {
				transformCalls.push(['translate', x, y]);
			}
		},
		getDrawPos(value) {
			return value;
		},
		height: 100,
		scale: 1,
		width: 100
	};
	ig.game = {
		_rscreen: {x: 0, y: 0}
	};

	const spikes = new EntitySpikes(4, 8, {
		size: {x: 40, y: 16}
	});
	const image = spikes.animSheet.image;
	const originalDraw = image.draw;

	image.loaded = true;
	image.width = 16;
	image.height = 16;
	image.draw = function(...args) {
		drawCalls.push(args);
	};

	try {
		assert.equal(ig.getClass('EntitySpikes'), EntitySpikes);
		assert.equal(spikes._wmScalable, true);
		assert.equal(spikes.checkAgainst, ig.Entity.TYPE.A);
		assert.deepEqual(spikes.size, {x: 40, y: 16});

		let killed = false;
		spikes.check({
			kill() {
				killed = true;
			}
		});
		assert.equal(killed, true);

		spikes.draw();
		assert.deepEqual(drawCalls, [
			[4, 8, 0, 0, 16, 16],
			[20, 8, 0, 0, 16, 16],
			[36, 8, 8, 0, 8, 16]
		]);

		drawCalls.length = 0;
		transformCalls.length = 0;

		const shortSpikes = new EntitySpikes(4, 8, {
			size: {x: 16, y: 12}
		});

		shortSpikes.draw();
		assert.deepEqual(drawCalls, [
			[4, 8, 0, 4, 16, 12]
		]);

		drawCalls.length = 0;
		transformCalls.length = 0;

		const rotatedSpikes = new EntitySpikes(4, 8, {
			rotateCcw: 'true',
			size: {x: 16, y: 40}
		});

		rotatedSpikes.draw();
		assert.deepEqual(drawCalls, [
			[0, 0, 0, 0, 16, 16],
			[0, 0, 0, 0, 16, 16],
			[0, 0, 8, 0, 8, 16]
		]);
		assert.deepEqual(
			transformCalls.filter((call) => call[0] == 'translate'),
			[
				['translate', 4, 24],
				['translate', 4, 40],
				['translate', 4, 48]
			]
		);
		assert.deepEqual(
			transformCalls.filter((call) => call[0] == 'rotate'),
			[
				['rotate', -Math.PI / 2],
				['rotate', -Math.PI / 2],
				['rotate', -Math.PI / 2]
			]
		);

		drawCalls.length = 0;
		transformCalls.length = 0;

		const narrowRotatedSpikes = new EntitySpikes(4, 8, {
			rotateCcw: 'true',
			size: {x: 12, y: 16}
		});

		narrowRotatedSpikes.draw();
		assert.deepEqual(drawCalls, [
			[0, 0, 0, 4, 16, 12]
		]);
		assert.deepEqual(
			transformCalls.filter((call) => call[0] == 'translate'),
			[
				['translate', 4, 24]
			]
		);
	}
	finally {
		image.draw = originalDraw;
	}
});
