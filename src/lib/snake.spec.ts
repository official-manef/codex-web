import { expect, test } from 'vitest';
import {
	advance,
	chooseMove,
	comparisonOrder,
	createGame,
	describeBoard,
	destination,
	directionToFood,
	DIRECTIONS,
	isSafe,
	randomSeed,
	requestedDelay,
	same,
	SIZE,
	validSeed,
	type Direction,
	type SnakeGame
} from './snake';

test('the seeded game is the historical layout and stays reproducible', () => {
	const game = createGame();
	expect(game.body).toEqual([
		{ x: 4, y: 6 },
		{ x: 3, y: 6 },
		{ x: 2, y: 6 }
	]);
	expect(game.food).toEqual({ x: 8, y: 6 });
	expect(game.direction).toBe('right');
	expect(game).toMatchObject({ score: 0, turns: 0, finished: false });
	// Same seed twice must produce the same board, or a replay would not be a replay.
	expect(createGame('demo')).toEqual(createGame('demo'));
});

test('only 1-64 seed-safe characters are accepted', () => {
	expect(validSeed('abc')).toBe(true);
	expect(validSeed('A.b_c-d')).toBe(true);
	expect(validSeed('a'.repeat(64))).toBe(true);
	for (const seed of ['', 'a'.repeat(65), 'has space', 'sla/sh', 'unicode-é', 'a\nb'])
		expect(validSeed(seed), JSON.stringify(seed)).toBe(false);
	expect(() => createGame('bad seed')).toThrow('seed');
	expect(() => createGame('')).toThrow('seed');
});

test('randomSeed is a 32-hex-char value that is itself a valid seed', () => {
	const seed = randomSeed();
	expect(seed).toMatch(/^[0-9a-f]{32}$/);
	expect(validSeed(seed)).toBe(true);
	expect(randomSeed()).not.toBe(seed);
});

test('a random seed places food on an empty cell, never inside the body', () => {
	for (let i = 0; i < 50; i++) {
		const game = createGame(randomSeed());
		expect(game.body.some((part) => same(part, game.food))).toBe(false);
		expect(game.food.x).toBeGreaterThanOrEqual(0);
		expect(game.food.x).toBeLessThan(SIZE);
		expect(game.food.y).toBeGreaterThanOrEqual(0);
		expect(game.food.y).toBeLessThan(SIZE);
	}
});

test('reversing into your own neck is never safe', () => {
	const game = createGame();
	// Direction is `right`, so `left` would put the head on its own second segment.
	expect(isSafe(game, 'left')).toBe(false);
	expect(isSafe(game, 'up')).toBe(true);
	expect(isSafe(game, 'right')).toBe(true);
});

test('walls are unsafe and the tail square is safe once it moves away', () => {
	const game = createGame();
	const atWall: SnakeGame = {
		...game,
		body: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 }
		]
	};
	expect(isSafe(atWall, 'left')).toBe(false);
	expect(isSafe(atWall, 'up')).toBe(false);
	// Moving onto the tail is legal on a non-eating turn, because the tail vacates it.
	// Head at (5,5), tail at (6,5): going right lands on the tail's current square.
	const ontoTail: SnakeGame = {
		...game,
		body: [
			{ x: 5, y: 5 },
			{ x: 5, y: 6 },
			{ x: 6, y: 5 }
		],
		direction: 'up',
		food: { x: 0, y: 0 }
	};
	expect(isSafe(ontoTail, 'right')).toBe(true);
	// But when the food sits on that square the tail stays put, so the move is a collision.
	expect(isSafe({ ...ontoTail, food: { x: 6, y: 5 } }, 'right')).toBe(false);
});

test('a finished game accepts no further move', () => {
	const game = createGame();
	expect(isSafe({ ...game, finished: true }, 'up')).toBe(false);
	expect(advance({ ...game, finished: true }, 'up').finished).toBe(true);
});

test('advance moves the head, drops the tail and counts the turn', () => {
	const game = createGame();
	const next = advance(game, 'up');
	expect(next.body[0]).toEqual({ x: 4, y: 5 });
	expect(next.body).toHaveLength(3);
	expect(next.turns).toBe(1);
	expect(next.direction).toBe('up');
	expect(next.score).toBe(0);
});

test('eating grows the snake by one and scores one', () => {
	const game: SnakeGame = {
		...createGame(),
		body: [
			{ x: 4, y: 6 },
			{ x: 3, y: 6 }
		],
		food: { x: 4, y: 5 }
	};
	const next = advance(game, 'up');
	expect(next.body).toHaveLength(3);
	expect(next.score).toBe(1);
	expect(same(next.food, { x: 4, y: 5 })).toBe(false);
});

test('an illegal move finishes the round without moving the body', () => {
	const game = createGame();
	const next = advance(game, 'left');
	expect(next.finished).toBe(true);
	expect(next.body).toEqual(game.body);
	expect(next.score).toBe(0);
});

test('food placement with an explicit rng state stays deterministic', () => {
	const game: SnakeGame = {
		...createGame('rng-seed'),
		body: [
			{ x: 4, y: 6 },
			{ x: 3, y: 6 }
		],
		food: { x: 4, y: 5 },
		rng_state: 12345
	};
	const a = advance(game, 'up');
	const b = advance(game, 'up');
	expect(a.food).toEqual(b.food);
	expect(a.rng_state).toBe(b.rng_state);
	expect(a.body.some((part) => same(part, a.food))).toBe(false);
});

test('filling the board finishes the round instead of looping forever', () => {
	const full: SnakeGame = {
		...createGame(),
		body: Array.from({ length: SIZE * SIZE - 1 }, (_, cell) => ({
			x: cell % SIZE,
			y: Math.floor(cell / SIZE)
		})),
		food: { x: (SIZE * SIZE - 1) % SIZE, y: Math.floor((SIZE * SIZE - 1) / SIZE) },
		direction: 'right'
	};
	// Arrange a head adjacent to the last free cell and eat it.
	const head = full.food;
	const last: SnakeGame = {
		...full,
		body: [head, ...full.body.slice(0, -1)],
		food: { x: 4, y: 6 }
	};
	expect(advance(last, 'left').finished).toBe(true);
});

test('chooseMove keeps a safe perceived direction and refuses an unsafe one', () => {
	const game = createGame();
	expect(chooseMove(game, 'up')).toMatchObject({ direction: 'up', overridden: false });
	// `left` is a reverse, so the policy overrides it with a legal move.
	const overridden = chooseMove(game, 'left');
	expect(overridden.overridden).toBe(true);
	expect(overridden.direction).not.toBe('left');
	expect(DIRECTIONS).toContain(overridden.direction!);
});

test('chooseMove falls back to null when every direction is blocked', () => {
	const trapped: SnakeGame = {
		...createGame(),
		body: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 }
		],
		food: { x: 5, y: 5 },
		direction: 'up'
	};
	const choice = chooseMove(trapped, 'nonsense');
	expect(choice.direction).toBeNull();
	expect(choice.reason).toContain('No legal move');
});

test('chooseMove ignores a perceived value that is not a direction', () => {
	const game = createGame();
	const choice = chooseMove(game, 'sideways');
	expect(choice.overridden).toBe(true);
	expect(choice.direction).not.toBeNull();
});

test('directionToFood and describeBoard agree on all four axes', () => {
	const game = createGame();
	const cases: Array<[Direction, string]> = [
		['up', 'above'],
		['right', 'to the right'],
		['down', 'below'],
		['left', 'to the left']
	];
	const head = game.body[0];
	const foodFor: Record<Direction, { x: number; y: number }> = {
		up: { x: head.x, y: 0 },
		right: { x: SIZE - 1, y: head.y },
		down: { x: head.x, y: SIZE - 1 },
		left: { x: 0, y: head.y }
	};
	for (const [direction, phrase] of cases) {
		const board: SnakeGame = { ...game, body: [head], food: foodFor[direction] };
		expect(directionToFood(board)).toBe(direction);
		expect(describeBoard(board)).toContain(phrase);
	}
});

test('destination steps one cell in the chosen direction', () => {
	const game = createGame();
	const head = game.body[0];
	expect(destination(game, 'up')).toEqual({ x: head.x, y: head.y - 1 });
	expect(destination(game, 'down')).toEqual({ x: head.x, y: head.y + 1 });
	expect(destination(game, 'left')).toEqual({ x: head.x - 1, y: head.y });
	expect(destination(game, 'right')).toEqual({ x: head.x + 1, y: head.y });
});

test('comparisonOrder rotates without dropping, duplicating or mutating', () => {
	const ids = ['a', 'b', 'c'];
	const source = [...ids];
	expect(comparisonOrder(ids, 0)).toEqual(['a', 'b', 'c']);
	expect(comparisonOrder(ids, 1)).toEqual(['b', 'c', 'a']);
	expect(comparisonOrder(ids, 2)).toEqual(['c', 'a', 'b']);
	expect(comparisonOrder(ids, 3)).toEqual(['a', 'b', 'c']);
	// A negative turn wraps rather than producing an empty rotation.
	expect(comparisonOrder(ids, -1)).toEqual(['c', 'a', 'b']);
	expect(comparisonOrder([], 5)).toEqual([]);
	expect(ids).toEqual(source);
	expect(comparisonOrder(ids, 1)).not.toBe(ids);
});

test('requestedDelay is the only place pacing becomes a number', () => {
	expect(requestedDelay('readable')).toBe(200);
	expect(requestedDelay('fast')).toBe(0);
});
