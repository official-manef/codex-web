import { z } from 'zod';
import type { AiProvider, ChatMessage } from './contracts';
import { textOf } from './contracts';
import type { IntegrationEnv } from '../integrations/config';

const modelName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
const modelsSchema = z
	.object({
		openai: z.array(modelName).max(20).default([]),
		anthropic: z.array(modelName).max(20).default([]),
		google: z.array(modelName).max(20).default([]),
		// 9router speaks the OpenAI protocol; it is a separate entry because its host and
		// catalog are not OpenAI's, and the key must never be sent to api.openai.com.
		'nine-router': z.array(modelName).max(40).default([])
	})
	.strict();
const keySchema = z
	.string()
	.min(8)
	.max(4096)
	.regex(/^[!-~]+$/);

const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;

function decodedBase64Size(data: string): number {
	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

const textPartSchema = z
	.object({
		type: z.literal('text'),
		text: z.string().max(8000)
	})
	.strict();

const imagePartSchema = z
	.object({
		type: z.literal('image'),
		mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
		data: z
			.string()
			.regex(base64Regex)
			.refine((data) => decodedBase64Size(data) <= 4 * 1024 * 1024, {
				message: 'Image decoded size exceeds 4 MB'
			})
	})
	.strict();

const partSchema = z.discriminatedUnion('type', [textPartSchema, imagePartSchema]);

const userContentSchema = z.union([z.string().min(1).max(8000), z.array(partSchema).min(1).max(4)]);

const assistantContentSchema = z.union([
	z.string().min(1).max(32000),
	z.array(partSchema).min(1).max(4)
]);

const chatSchema = z
	.object({
		provider: z.enum(['openai', 'anthropic', 'google', 'nine-router']),
		model: modelName,
		apiKey: keySchema,
		memory: z.string().max(2000).optional(),
		toolUse: z.boolean().default(false),
		messages: z
			.array(
				z.discriminatedUnion('role', [
					z.object({ role: z.literal('user'), content: userContentSchema }).strict(),
					z.object({ role: z.literal('assistant'), content: assistantContentSchema }).strict()
				])
			)
			.min(1)
			.max(16)
	})
	.strict()
	.superRefine((data, ctx) => {
		let imageCount = 0;
		for (const msg of data.messages) {
			if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === 'image') {
						imageCount++;
					}
				}
			}
		}
		if (imageCount > 2) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'At most 2 image parts per request'
			});
		}
	});

export function flag(value: string | undefined, name: string) {
	if (!value || value === 'false') return false;
	if (value === 'true') return true;
	throw new Error(`${name} must be true or false`);
}

export function aiSettings(env: IntegrationEnv) {
	if (!flag(env.AI_ENABLED, 'AI_ENABLED')) return { enabled: false, providers: [] };
	if (!env.AI_MODELS_JSON || env.AI_MODELS_JSON.length > 16000)
		throw new Error('Configure AI_MODELS_JSON');
	const models = modelsSchema.parse(JSON.parse(env.AI_MODELS_JSON));
	const labels = {
		openai: 'OpenAI',
		anthropic: 'Anthropic',
		google: 'Google',
		'nine-router': '9router'
	};
	const providers = (Object.keys(labels) as AiProvider[])
		.filter((id) => models[id].length)
		.map((id) => ({ id, label: labels[id], models: [...new Set(models[id])] }));
	if (!providers.length) throw new Error('Configure at least one approved AI model');
	return { enabled: true, providers };
}

export function parseChat(
	env: IntegrationEnv,
	value: unknown
): {
	provider: AiProvider;
	model: string;
	apiKey: string;
	messages: ChatMessage[];
	memory?: string;
	toolUse: boolean;
} {
	const settings = aiSettings(env);
	if (!settings.enabled) throw new Error('AI is disabled');
	const input = chatSchema.parse(value);
	if (
		!settings.providers
			.find((provider) => provider.id === input.provider)
			?.models.includes(input.model)
	)
		throw new Error('Model is not approved');
	if (
		input.messages.at(-1)?.role !== 'user' ||
		input.messages.reduce((size, message) => size + textOf(message.content).length, 0) > 32000
	)
		throw new Error('Conversation exceeds the limit or has no final user message');
	return input;
}

export function byokToken(value: unknown) {
	return keySchema.parse(value);
}
