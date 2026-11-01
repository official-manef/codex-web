import type { PolicyDecision } from '../policy';

export type AiProvider = 'openai' | 'anthropic' | 'google' | 'nine-router';
export type TextPart = { type: 'text'; text: string };
export type ImagePart = {
	type: 'image';
	mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
	data: string;
};
export type ChatContent = string | Array<TextPart | ImagePart>;
export type ChatMessage = { role: 'user' | 'assistant'; content: ChatContent };
export type ChatEvent =
	| { type: 'text'; text: string }
	| { type: 'error'; message: string }
	| { type: 'done' }
	| { type: 'tool'; name: string; decision: PolicyDecision; text?: string };

export function textOf(content: ChatContent): string {
	if (typeof content === 'string') return content;
	return content
		.filter((part): part is TextPart => part.type === 'text')
		.map((part) => part.text)
		.join('');
}

export function imagesOf(content: ChatContent): ImagePart[] {
	if (typeof content === 'string') return [];
	return content.filter((part): part is ImagePart => part.type === 'image');
}
