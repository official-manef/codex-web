import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import convex from '@convex-dev/eslint-plugin';
import { runtimeBoundary, sliceBoundary } from './scripts/eslint-boundaries.mjs';
import { noConvexCollect } from './scripts/eslint-convex.mjs';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{ ignores: ['src/convex/_generated/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		plugins: {
			starter: {
				rules: {
					'slice-boundaries': sliceBoundary,
					'runtime-boundaries': runtimeBoundary,
					'no-convex-collect': noConvexCollect
				}
			}
		},
		rules: {
			'starter/slice-boundaries': 'error',
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: [
			'src/**/*.{ts,svelte}',
			'slices/**/*.{ts,svelte}',
			'scripts/**/*.ts',
			'assets.config.ts',
			'vite.config.ts'
		],
		ignores: ['**/*.d.ts', 'src/lib/components/ui/**'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.svelte']
			}
		},
		rules: {
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/only-throw-error': 'error',
			'@typescript-eslint/prefer-promise-reject-errors': 'error',
			'@typescript-eslint/switch-exhaustiveness-check': 'error'
		}
	},
	{
		files: ['src/convex/**/*.ts'],
		ignores: ['**/*.{test,spec}.ts', '**/*.d.ts'],
		plugins: { '@convex-dev': convex },
		rules: {
			'@convex-dev/no-old-registered-function-syntax': 'error',
			'@convex-dev/require-args-validator': 'error',
			'@convex-dev/explicit-table-ids': 'error',
			'@convex-dev/no-filter-in-query': 'error',
			'starter/no-convex-collect': 'error',
			'@convex-dev/no-schema-import-cycle': 'error'
		}
	},
	{
		files: ['src/**/*.{js,ts,svelte}', 'slices/**/*.{js,ts,svelte}'],
		ignores: ['**/*.{test,spec}.{js,ts}', '**/*.d.ts'],
		rules: { 'starter/runtime-boundaries': 'error' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		files: ['**/*.svelte'],
		rules: {
			'svelte/no-at-html-tags': 'error',
			// A boundary's failed(_error, reset) snippet needs its unused first argument.
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
		}
	},
	{
		// The public legal and landing pages link mostly to absolute external URLs (the source
		// repository, the app origin) plus two sibling pages. `resolve()` is typed for internal
		// SvelteKit routes only, so wrapping an external URL in it is a type error, and the rule
		// has no way to express "external is fine". The pages are static: no `goto`, no
		// pushState, and every internal link is a plain path that exists.
		files: [
			'src/routes/home/**/*.svelte',
			'src/routes/privacy/**/*.svelte',
			'src/routes/terms/**/*.svelte'
		],
		rules: { 'svelte/no-navigation-without-resolve': 'off' }
	},
	{
		files: ['src/lib/components/ui/**/*.svelte'],
		rules: {
			// Generated shadcn primitives intentionally accept external href values.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// Vendored Laya files. Everything under `slices/workspace-shell/**`, `shared/**`,
		// `src/lib/views/**` and the copied `src/lib/*` helpers is byte-identical to
		// rahmanef63/laya-npu so the whole set can be re-synced with a plain diff
		// (docs/laya-parity.md §6).
		//
		// Why an exception instead of fixing the findings: Laya has no linter at all
		// (`package.json` has no eslint dependency or `lint` script), so "fix it upstream
		// and re-copy" is not an available path. Adopting a stricter rule set here would
		// fork 45 files and make the next pull a manual merge. The rules below are the
		// minimum needed to keep the copy byte-identical; everything else still applies.
		//
		// [P1] deviation. Consumer code — `src/routes/**`, `slices/workspace-surface/**`,
		// `src/lib/http.local.ts`, `src/lib/workspace_*.ts`, `src/lib/template_*.ts`,
		// `src/lib/registry.ts` and the UI primitives — is NOT covered and passes the full
		// rule set. Revisit as P2 style work, not as a blocker.
		files: [
			'slices/workspace-shell/**',
			'shared/**',
			'src/lib/views/**',
			'src/lib/AppSelect.svelte',
			'src/lib/AttachmentPreview.svelte',
			'src/lib/BackendChip.svelte',
			'src/lib/BrowserAutomation.svelte',
			'src/lib/ChatTools.svelte',
			'src/lib/Deps.svelte',
			'src/lib/HostedGate.svelte',
			'src/lib/MicrophoneSelect.svelte',
			'src/lib/ModelCapabilities.svelte',
			'src/lib/PanelResizeHandle.svelte',
			'src/lib/Recorder.svelte',
			'src/lib/RecoveryNotice.svelte',
			'src/lib/RichText.svelte',
			'src/lib/RuntimeControls.svelte',
			'src/lib/SectionNav.svelte',
			'src/lib/SettingsWindow.svelte',
			'src/lib/SiteHeader.svelte',
			'src/lib/SnakeHistory.svelte',
			'src/lib/SpeechControls.svelte',
			'src/lib/View.svelte',
			'src/lib/WorkflowCanvas.svelte',
			'src/lib/WorkflowStudio.svelte',
			'src/lib/WorkspaceLauncher.svelte',
			'src/lib/api.ts',
			'src/lib/composer_commands.ts',
			'src/lib/draft_storage.ts',
			'src/lib/drafts.ts',
			'src/lib/file_canvas_layout.ts',
			'src/lib/file_canvas_tabs.ts',
			'src/lib/laya_*.ts',
			'src/lib/markdown.ts',
			'src/lib/recording.ts',
			'src/lib/recovery.ts',
			'src/lib/reference_workspace.ts',
			'src/lib/snake.ts',
			'src/lib/webmcp.ts',
			'src/lib/workflow_graph.ts'
		],
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
			'@typescript-eslint/await-thenable': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
			'no-useless-assignment': 'off',
			'no-empty': 'off',
			'no-useless-escape': 'off',
			'no-control-regex': 'off',
			'preserve-caught-error': 'off',
			'svelte/require-each-key': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			'svelte/prefer-writable-derived': 'off',
			'svelte/no-useless-children-snippet': 'off',
			'svelte/no-unused-props': 'off',
			'svelte/no-navigation-without-resolve': 'off',
			'starter/slice-boundaries': 'off'
		}
	}
);
