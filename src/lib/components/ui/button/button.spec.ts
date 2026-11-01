import { describe, expect, test } from 'vitest';
import { buttonVariants } from './button.svelte';

/**
 * `buttonVariants` used to be a `tailwind-variants` `tv()` call. It is now a plain
 * `cn(BASE, variant, size)` — 40 kB lighter on the initial payload — so the class string is
 * the contract: these assertions fail if the merge order or a variant map drifts.
 */
describe('buttonVariants', () => {
	test('defaults resolve to default variant and size', () => {
		expect(buttonVariants()).toBe(buttonVariants({ variant: 'default', size: 'default' }));
	});

	test('a size overrides the base text size, and a caller class wins last', () => {
		const sm = buttonVariants({ size: 'sm' });
		expect(sm).toContain('h-7');
		expect(sm).toContain('text-[0.8rem]');
		expect(sm).not.toContain('h-8');
		expect(buttonVariants({ size: 'sm', class: 'h-99' })).toContain('h-99');
		expect(buttonVariants({ size: 'sm', class: 'h-99' })).not.toContain('h-7');
	});

	test('every variant and size key produces a non-empty string', () => {
		const variants = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const;
		const sizes = ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const;
		for (const variant of variants) {
			for (const size of sizes) {
				const classes = buttonVariants({ variant, size });
				expect(classes, `${variant}/${size}`).toContain('inline-flex');
				expect(classes.length, `${variant}/${size}`).toBeGreaterThan(40);
			}
		}
	});
});
