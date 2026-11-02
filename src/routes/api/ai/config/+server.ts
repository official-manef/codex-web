import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { requireCapabilityAccess } from '$lib/server/access';
import { aiSettings } from '$lib/server/ai/config';
import { mcpConnections } from '$lib/server/mcp/config';
import { logEvent } from '$lib/server/log';
import { EFFORTS, effortForProvider } from '$lib/reasoning';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	// Guarded even when both features are off: the answer still names provider ids and aliases,
	// and a feature being disabled is not a reason to hand the catalog to an anonymous caller.
	await requireCapabilityAccess(event, { surface: 'byok' });
	try {
		const ai = aiSettings(env);
		const servers = mcpConnections(env);
		await logEvent('debug', 'ai.config', {
			providers: ai.providers.length,
			models: ai.providers.reduce((total, provider) => total + provider.models.length, 0),
			mcpEnabled: env.MCP_CLIENT_ENABLED === 'true',
			mcpServers: servers.length
		});
		return json(
			{
				ai: {
					...ai,
					providers: ai.providers.map((provider) => ({
						...provider,
						efforts: EFFORTS.filter((effort) => effortForProvider(provider.id, effort).accepted)
					}))
				},
				mcp: {
					enabled: env.MCP_CLIENT_ENABLED === 'true',
					servers: servers.map(({ alias }) => ({ alias }))
				}
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch {
		await logEvent('warn', 'ai.config', { outcome: 'invalid-configuration' });
		error(503, 'Assistant setup is incomplete. Check the private server configuration.');
	}
};
