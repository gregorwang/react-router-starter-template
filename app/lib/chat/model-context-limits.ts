/**
 * Model context window limits.
 *
 * Used by the Prompt Builder to dynamically allocate token budgets
 * instead of hardcoding a single number for all models.
 */

const MODEL_CTX_MAX: Record<string, number> = {
	// xAI
	"grok-4-1-fast-reasoning": 131072,
	"grok-4-1-fast-non-reasoning": 131072,
	"grok-code-fast-1": 131072,
	"grok-4-fast-reasoning": 131072,
	"grok-4-fast-non-reasoning": 131072,
	"grok-4-0709": 131072,
	"grok-3-mini": 131072,
	"grok-3": 131072,
	"grok-2-vision-1212": 32768,

	// Poe
	"grok-4.1-fast-reasoning": 131072,
	"kimi-k2.5": 131072,
	"claude-sonnet-4.5": 200000,
	"o3": 200000,
	"gemini-3-pro": 1048576,

	// DeepSeek
	"deepseek-chat": 65536,
	"deepseek-reasoner": 65536,

	// PoloAI (Anthropic models)
	"claude-opus-4-6": 200000,
	"claude-opus-4-5-20251101-thinking": 200000,
	"claude-sonnet-4-6-thinking": 200000,
	"claude-sonnet-4-5-20250929-thinking": 200000,
	"claude-sonnet-4-5-20250929": 200000,
	"claude-haiku-4-5-20251001-thinking": 200000,

	// Ark
	"ark-code-latest": 32768,

	// Workers AI
	"@cf/meta/llama-3.1-8b-instruct": 8192,
	"@cf/meta/llama-3.1-70b-instruct": 8192,
	"@cf/qwen/qwen1.5-7b-chat": 8192,
};

const DEFAULT_CTX_MAX = 32000;
const DEFAULT_OUT_RESERVE = 4096;

export interface ModelContextLimits {
	/** Maximum input + output tokens the model supports. */
	ctxMax: number;
	/** Tokens reserved for model output. */
	outReserve: number;
	/** Available budget for input (ctxMax − outReserve). */
	inputBudget: number;
}

export function getModelContextLimits(model: string): ModelContextLimits {
	const ctxMax = MODEL_CTX_MAX[model] ?? DEFAULT_CTX_MAX;
	const outReserve = Math.min(DEFAULT_OUT_RESERVE, Math.floor(ctxMax * 0.15));
	return {
		ctxMax,
		outReserve,
		inputBudget: ctxMax - outReserve,
	};
}
