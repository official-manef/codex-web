export function validPinnedSessions(value: unknown): string[] {
	// Chat ids are `session-<base36 time>-<sequence>`, not hex; the old `[a-f0-9]{32}` filter
	// rejected every real id, so `pinSession` wrote an empty list back and the pin control
	// looked dead. Only the shape the store issues is accepted, plus the legacy hex form so an
	// already-pinned chat from the older build is not silently unpinned.
	return Array.isArray(value)
		? [
				...new Set(
					value.filter(
						(id): id is string =>
							typeof id === "string" &&
							(/^[A-Za-z0-9_-]{1,128}$/.test(id) || /^[a-f0-9]{32}$/.test(id)),
					),
				),
			].slice(0, 100)
		: [];
}
export function togglePinnedSession(value: unknown, id: string): string[] {
  const current = validPinnedSessions(value);
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : validPinnedSessions([...current, id]);
}
export function isNearLatest(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight < 120;
}
