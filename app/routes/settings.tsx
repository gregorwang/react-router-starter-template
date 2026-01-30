import { ProviderCard } from "../components/settings/ProviderCard";
import type { LLMProvider } from "../lib/llm/types";

export default function Settings() {
	const providers: LLMProvider[] = ["openai", "anthropic", "google", "deepseek"];

	return (
		<div className="max-w-4xl mx-auto py-8 px-4">
			<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">
				Settings
			</h1>
			<p className="text-gray-600 dark:text-gray-400 mb-8">
				Configure your API keys to use different LLM providers. Your keys are stored
				locally in your browser and are never sent to any server other than the
				respective provider's API.
			</p>
			<div className="grid gap-6 md:grid-cols-2">
				{providers.map((provider) => (
					<ProviderCard key={provider} provider={provider} />
				))}
			</div>
		</div>
	);
}
