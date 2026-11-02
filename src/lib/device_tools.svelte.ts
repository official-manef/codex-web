/**
 * Device-backed tool switches.
 *
 * Terminal and remote browser view need a paired device; both start off, on every surface.
 * A switch here says the user wants the tool, not that a device exists: the tool still
 * appears only when a device of that kind is paired.
 *
 * Storage is `localStorage` under `workspace-template:device-tools-v1`, wrapped in the shared
 * version envelope (see `#lib/storage_version`). A bare array — what the build before the
 * envelope wrote — is version 0 and is migrated once.
 */
import {
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec
} from '#lib/storage_version.js';

export type DeviceTool = 'terminal' | 'browser';

export const DEVICE_TOOLS_STORAGE_KEY = 'workspace-template:device-tools-v1';

const TOOLS: readonly DeviceTool[] = ['terminal', 'browser'];

function isDeviceTool(value: unknown): value is DeviceTool {
	return typeof value === 'string' && (TOOLS as readonly string[]).includes(value);
}

function validate(value: unknown): { value: DeviceTool[]; dropped: number } | null {
	if (!Array.isArray(value)) return null;
	// An id this build does not ship is not corruption; it stays out of the switch list and is
	// not counted, because a newer build may have written a tool this one has never heard of.
	return { value: value.filter(isDeviceTool), dropped: 0 };
}

const SPEC: VersionedSpec<DeviceTool[]> = {
	key: DEVICE_TOOLS_STORAGE_KEY,
	current: 1,
	maxChars: 1024,
	fromLegacy: (parsed) => (Array.isArray(parsed) ? parsed : null),
	validate
};

function storage(): StorageLike | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

export function createDeviceTools() {
	let enabled = $state<DeviceTool[]>([]);
	let started = false;
	let quarantined = $state<string | null>(null);
	let newer = $state(false);

	function read(): DeviceTool[] {
		const result = readVersioned(SPEC, storage);
		quarantined = result.quarantineKey;
		newer = result.status === 'newer';
		return result.value ?? [];
	}

	function write(next: DeviceTool[]): void {
		writeVersioned(SPEC, next, storage);
	}

	return {
		/** Starts on the SSR-safe "everything off" value; the host calls this on mount. */
		start(): void {
			if (started) return;
			started = true;
			enabled = read();
		},
		/** Key holding a verbatim copy of a payload this build could not read, if any. */
		get quarantined(): string | null {
			return quarantined;
		},
		/** True when storage holds a version this build cannot read and therefore must not write. */
		get newer(): boolean {
			return newer;
		},
		isEnabled(tool: DeviceTool): boolean {
			return enabled.includes(tool);
		},
		setEnabled(tool: DeviceTool, value: boolean): void {
			if (enabled.includes(tool) === value) return;
			enabled = value ? [...enabled, tool] : enabled.filter((entry) => entry !== tool);
			write(enabled);
		}
	};
}

export const deviceTools = createDeviceTools();
