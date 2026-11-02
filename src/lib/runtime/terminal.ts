/**
 * Client for a terminal stream on the user's own bridge.
 *
 * Transport: one WebSocket per terminal at `<origin>/v1/terminal`. The pairing token goes
 * in the `Sec-WebSocket-Protocol` field as `bearer.<token>`, because a browser cannot set
 * an Authorization header on a WebSocket. It is never placed in the URL, so it cannot end
 * up in a proxy log, a Referer header or browser history.
 *
 * Pure enough to unit test: pass `socketFactory` to supply a fake socket.
 */
export type TerminalStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/** The slice of `WebSocket` this module needs. Structural, so a fake can satisfy it. */
export type TerminalSocket = {
	readyState: number;
	send(data: string): void;
	close(): void;
	onopen: ((event: unknown) => void) | null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
};

export type TerminalSocketFactory = (url: string, protocols: string[]) => TerminalSocket;

export type TerminalOptions = {
	endpoint: string;
	token: string;
	onData: (chunk: string) => void;
	onStatus: (status: TerminalStatus, detail?: string) => void;
	socketFactory?: TerminalSocketFactory;
};

export type Terminal = {
	send(input: string): void;
	resize(cols: number, rows: number): void;
	close(): void;
};

export const TERMINAL_PATH = '/v1/terminal';
export const MAX_INPUT_CHARS = 4096;
export const MAX_FRAME_CHARS = 65536;
export const MAX_CONSECUTIVE_ERRORS = 3;
const MAX_COLS = 500;
const MAX_ROWS = 300;
const OPEN = 1;

// A WebSocket subprotocol name may only use RFC 6455 tchar. Base64 with +, / or = would
// throw inside `new WebSocket`, so reject it here with a message the user can act on.
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,512}$/;

function defaultSocketFactory(url: string, protocols: string[]): TerminalSocket {
	return new WebSocket(url, protocols) as unknown as TerminalSocket;
}

function boundedInteger(value: number, min: number, max: number): number | null {
	if (!Number.isFinite(value)) return null;
	const rounded = Math.round(value);
	return rounded < min || rounded > max ? null : rounded;
}

export function createTerminal(options: TerminalOptions): Terminal {
	const factory = options.socketFactory ?? defaultSocketFactory;
	let socket: TerminalSocket | null = null;
	let closed = false;
	let everOpened = false;
	// The reason the socket last failed, kept so the close message can name a cause. A browser
	// reports every refused handshake as 1006 "abnormal closure" and drops the HTTP status, so
	// the close text alone tells the user nothing about the token or the origin.
	let lastFailure = '';
	let consecutiveErrors = 0;

	function report(status: TerminalStatus, detail?: string): void {
		if (closed && status !== 'closed' && status !== 'error') return;
		options.onStatus(status, detail);
	}

	function fail(detail: string): void {
		lastFailure = detail;
		if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return;
		consecutiveErrors += 1;
		options.onStatus('error', detail);
	}

	function detach(target: TerminalSocket): void {
		target.onopen = null;
		target.onclose = null;
		target.onerror = null;
		target.onmessage = null;
	}

	let origin: string;
	try {
		origin = new URL(options.endpoint).origin;
	} catch {
		options.onStatus('error', 'That endpoint is not a valid URL.');
		closed = true;
		return {
			send: () => {},
			resize: () => {},
			close: () => {}
		};
	}
	if (!TOKEN_PATTERN.test(options.token)) {
		options.onStatus('error', 'The pairing token is missing or malformed.');
		closed = true;
		return {
			send: () => {},
			resize: () => {},
			close: () => {}
		};
	}

	options.onStatus('connecting');
	try {
		socket = factory(`${origin}${TERMINAL_PATH}`, [`bearer.${options.token}`]);
	} catch (error) {
		closed = true;
		options.onStatus(
			'error',
			error instanceof Error ? error.message : 'The terminal socket could not be created.'
		);
		return {
			send: () => {},
			resize: () => {},
			close: () => {}
		};
	}

	socket.onopen = () => {
		consecutiveErrors = 0;
		everOpened = true;
		lastFailure = '';
		report('open');
	};
	socket.onmessage = (event) => {
		consecutiveErrors = 0;
		const data = event.data;
		if (typeof data !== 'string') {
			fail('The bridge sent a non-text frame; binary terminal frames are not supported.');
			return;
		}
		if (data.length > MAX_FRAME_CHARS) {
			fail(`Dropped a ${data.length}-character frame; the limit is ${MAX_FRAME_CHARS}.`);
			return;
		}
		options.onData(data);
	};
	socket.onerror = () => {
		// A refused handshake never reaches `onopen`. The status (401 wrong token, 403 origin,
		// 503 full) is not visible to the browser's WebSocket API, so name the likely causes.
		fail(
			everOpened
				? 'The terminal connection failed. Check the endpoint and token.'
				: 'The bridge refused the connection: check the pairing token, and that this page’s origin is allowed by the bridge.'
		);
	};
	socket.onclose = (event) => {
		detach(socket as TerminalSocket);
		closed = true;
		const reason = event?.reason ? ` ${event.reason}` : '';
		const code = typeof event?.code === 'number' ? ` (code ${event.code})` : '';
		// A refused handshake closes with 1006 and no reason, which names nothing at all. Append
		// the cause `onerror` recorded, so the panel states why instead of echoing a number.
		const cause = !everOpened && lastFailure ? ` ${lastFailure}` : '';
		report('closed', `The bridge closed the connection.${code}${reason}${cause}`);
	};

	function send(input: string): void {
		if (closed || !socket || socket.readyState !== OPEN) return;
		if (input.length > MAX_INPUT_CHARS) {
			fail(`Input is ${input.length} characters; the limit is ${MAX_INPUT_CHARS}.`);
			return;
		}
		socket.send(input);
	}

	function resize(cols: number, rows: number): void {
		if (closed || !socket || socket.readyState !== OPEN) return;
		const width = boundedInteger(cols, 1, MAX_COLS);
		const height = boundedInteger(rows, 1, MAX_ROWS);
		if (width === null || height === null) return;
		socket.send(JSON.stringify({ type: 'resize', cols: width, rows: height }));
	}

	function close(): void {
		if (closed) return;
		closed = true;
		const current = socket;
		socket = null;
		if (!current) return;
		detach(current);
		// A socket that is still connecting cannot be closed cleanly; closing it anyway is
		// safer than leaving the browser to finish a handshake nobody waits for.
		try {
			current.close();
		} catch {
			// Already gone: close is a request, not a guarantee.
		}
		report('closed', 'Closed by you.');
	}

	return { send, resize, close };
}
