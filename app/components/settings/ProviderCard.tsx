import { ApiKeyInput } from "./ApiKeyInput";
import { useSettings } from "../../hooks/useSettings";
import type { LLMProvider } from "../../lib/llm/types";
import { PROVIDER_NAMES, PROVIDER_MODELS } from "../../lib/llm/types";

interface ProviderCardProps {
	provider: LLMProvider;
}

export function ProviderCard({ provider }: ProviderCardProps) {
	const { settings, updateApiKey, updateModel } = useSettings();
	const providerName = PROVIDER_NAMES[provider];
	const models = PROVIDER_MODELS[provider];
	const apiKeyKey = `${provider}ApiKey` as keyof typeof settings;
	const modelKey = `${provider}Model` as keyof typeof settings;

	return (
		<div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
			<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
				{providerName}
			</h3>
			<div className="space-y-4">
				<ApiKeyInput
					label="API Key"
					value={settings[apiKeyKey] as string}
					onChange={(value) => updateApiKey(provider, value)}
				/>
				<div>
					<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
						Model
					</label>
					<select
						value={settings[modelKey] as string}
						onChange={(e) => updateModel(provider, e.target.value)}
						className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
					>
						{models.map((model) => (
							<option key={model} value={model}>
								{model}
							</option>
						))}
					</select>
				</div>
			</div>
		</div>
	);
}
