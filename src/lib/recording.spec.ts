import { expect, test, vi } from 'vitest';
import { acquireMicrophone, recordingMime, releaseMicrophone } from './recording';

/**
 * The microphone is a user grant. These pin what happens to it when a permission dialog
 * resolves after the caller gave up, and that a track that throws while stopping does not
 * leave the others open.
 */

function track(throws = false) {
	return {
		stop: vi.fn(() => {
			if (throws) throw new Error('driver failure');
		})
	};
}

type FakeTrack = ReturnType<typeof track>;

function stream(tracks: FakeTrack[]) {
	return { getTracks: () => tracks } as unknown as Pick<MediaStream, 'getTracks'>;
}

test('releaseMicrophone stops every track even when one driver throws', () => {
	const first = track();
	const second = track(true);
	const third = track();
	releaseMicrophone(stream([first, second, third]));
	expect(first.stop).toHaveBeenCalledTimes(1);
	expect(second.stop).toHaveBeenCalledTimes(1);
	expect(third.stop).toHaveBeenCalledTimes(1);
});

test('releaseMicrophone accepts no stream and a stream with no tracks', () => {
	expect(() => releaseMicrophone(null)).not.toThrow();
	expect(() => releaseMicrophone(stream([]))).not.toThrow();
	// A driver that reports no `getTracks` is a stream this code did not create.
	// A driver that reports no tracks at all is still a stream this code may be handed.
	const empty = { getTracks: () => undefined } as unknown as Pick<MediaStream, 'getTracks'>;
	expect(() => releaseMicrophone(empty)).not.toThrow();
});

test('acquireMicrophone releases the tracks when the request is no longer current', async () => {
	const mic = stream([track()]);
	const result = await acquireMicrophone(
		async () => mic as unknown as MediaStream,
		() => false
	);
	expect(result).toBeNull();
	// Permission granted after the caller cancelled must not leave the microphone open.
	expect(mic.getTracks()[0].stop).toHaveBeenCalled();
});

test('acquireMicrophone keeps the stream when the request is still current', async () => {
	const mic = stream([track()]);
	const result = await acquireMicrophone(
		async () => mic as unknown as MediaStream,
		() => true
	);
	expect(result).toBe(mic);
	expect(mic.getTracks()[0].stop).not.toHaveBeenCalled();
});

test('acquireMicrophone propagates a denied permission instead of returning a dead stream', async () => {
	await expect(
		acquireMicrophone(
			() => Promise.reject(new DOMException('denied', 'NotAllowedError')),
			() => true
		)
	).rejects.toThrow(/denied/);
});

test('acquireMicrophone checks currency after the promise resolves, not before', async () => {
	let current = false;
	const mic = stream([track()]);
	const pending = acquireMicrophone(
		async () => mic as unknown as MediaStream,
		() => current
	);
	current = true;
	await expect(pending).resolves.toBe(mic);
});

test('recordingMime prefers opus in webm, then ogg, then mp4', () => {
	expect(recordingMime(() => true)).toBe('audio/webm;codecs=opus');
	expect(recordingMime((mime) => mime !== 'audio/webm;codecs=opus')).toBe('audio/ogg;codecs=opus');
	expect(recordingMime((mime) => mime === 'audio/mp4')).toBe('audio/mp4');
	// Nothing supported means "let the browser pick", not a format it will refuse.
	expect(recordingMime(() => false)).toBeUndefined();
});

test('recordingMime asks only about the formats it can encode', () => {
	const asked: string[] = [];
	recordingMime((mime) => {
		asked.push(mime);
		return false;
	});
	expect(asked).toEqual(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']);
});
