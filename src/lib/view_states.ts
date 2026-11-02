/**
 * The four states a screen with a device list can be in.
 *
 * Three screens (`Providers`, `Compute`, `Overview`) render the same dependency: the shell's
 * `backends` prop plus its `connection` status. Keeping the decision here means the four
 * states cannot drift apart, and it is testable without a browser because it is a pure
 * function of two values.
 *
 * See `docs/empty-states-2026-11-02.md`. The defect this replaces is the one that matters:
 * `checking` used to fall through to "no device is detected", so every boot read as a machine
 * with no NPU.
 */

export type Connection = 'checking' | 'online' | 'offline';

export type DeviceListState = 'loading' | 'error' | 'empty' | 'ready';

export function deviceListState(input: {
	connection: Connection;
	backends: readonly unknown[];
}): DeviceListState {
	if (input.connection === 'checking') return 'loading';
	if (input.connection === 'offline') return 'error';
	return input.backends.length === 0 ? 'empty' : 'ready';
}
