import { expect, test } from 'vitest';
import {
	fileTreeBounds,
	visibleFileTreeWidth,
	DEFAULT_FILE_TREE_WIDTH,
	MAX_FILE_TREE_WIDTH
} from './file_canvas_layout';

/**
 * The file tree is right-anchored, so its width decides whether a document is readable at all.
 * These are about the space left over for the document, including a container too narrow to
 * satisfy both minimums.
 */

test('a wide container allows the tree up to its maximum and reserves a document area', () => {
	expect(fileTreeBounds(1200)).toEqual({ min: 120, max: 420 });
	// At 728px there is exactly room for the tree plus the preferred document width plus handle.
	expect(fileTreeBounds(628)).toEqual({ min: 120, max: 420 });
	// One pixel narrower starts eating the tree, not the document.
	expect(fileTreeBounds(627).max).toBe(419);
});

test('a container narrower than the tree minimum shrinks the minimum with it', () => {
	// The tree gets whatever is left after the document minimum and the handle.
	expect(fileTreeBounds(100)).toEqual({ min: 0, max: 0 });
	expect(fileTreeBounds(128)).toEqual({ min: 0, max: 0 });
	expect(fileTreeBounds(129)).toEqual({ min: 1, max: 1 });
	expect(fileTreeBounds(200)).toEqual({ min: 72, max: 72 });
	expect(fileTreeBounds(248)).toEqual({ min: 120, max: 120 });
});

test('a nonsensical container width is treated as zero rather than propagated', () => {
	for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -500, -0]) {
		const bounds = fileTreeBounds(width);
		expect(bounds.min, String(width)).toBe(bounds.min);
		expect(Number.isFinite(bounds.min), String(width)).toBe(true);
		expect(Number.isFinite(bounds.max), String(width)).toBe(true);
		expect(bounds.min, String(width)).toBeGreaterThanOrEqual(0);
		expect(bounds.max, String(width)).toBeGreaterThanOrEqual(bounds.min);
	}
	// An infinite container is "unknown", not "unbounded": NaN would otherwise reach the DOM.
	expect(fileTreeBounds(Number.POSITIVE_INFINITY)).toEqual({ min: 0, max: 0 });
});

test('the max is never below the min, so a drag cannot invert the range', () => {
	for (let width = 0; width <= 1400; width += 7) {
		const { min, max } = fileTreeBounds(width);
		expect(max, String(width)).toBeGreaterThanOrEqual(min);
	}
});

test('a preferred width inside the range is used as-is', () => {
	expect(visibleFileTreeWidth(300, 1200)).toBe(300);
	expect(visibleFileTreeWidth(DEFAULT_FILE_TREE_WIDTH, 1200)).toBe(DEFAULT_FILE_TREE_WIDTH);
});

test('a preferred width outside the range is clamped to the container it can have', () => {
	expect(visibleFileTreeWidth(900, 1200)).toBe(MAX_FILE_TREE_WIDTH);
	expect(visibleFileTreeWidth(10, 1200)).toBe(120);
	// In a narrow container the maximum follows the container, not the constant.
	expect(visibleFileTreeWidth(900, 400)).toBe(192);
	expect(visibleFileTreeWidth(900, 100)).toBe(0);
});

test('an unrenderable preferred width falls back to the default instead of collapsing the tree', () => {
	for (const preferred of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		expect(visibleFileTreeWidth(preferred, 1200), String(preferred)).toBe(DEFAULT_FILE_TREE_WIDTH);
	}
	// The fallback is still clamped by the container.
	expect(visibleFileTreeWidth(Number.NaN, 100)).toBe(0);
});

test('the returned width always lies inside the bounds the handle advertises', () => {
	for (const width of [0, 100, 248, 400, 628, 900, 1200, 3000]) {
		const { min, max } = fileTreeBounds(width);
		for (const preferred of [-100, 0, 120, 240, 420, 5000, Number.NaN]) {
			const rendered = visibleFileTreeWidth(preferred, width);
			expect(rendered, `${preferred} in ${width}`).toBeGreaterThanOrEqual(min);
			expect(rendered, `${preferred} in ${width}`).toBeLessThanOrEqual(max);
		}
	}
});
