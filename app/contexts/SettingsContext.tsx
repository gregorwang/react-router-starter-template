import { createContext, useContext, useState, useCallback } from "react";
import type { Settings, LLMProvider } from "../lib/llm/types";
import { getSettings, saveSettings } from "../lib/storage/settings-store";

interface SettingsContextValue {
	settings: Settings;
	updateSettings: (settings: Settings) => void;
	updateApiKey: (provider: LLMProvider, apiKey: string) => void;
	updateModel: (provider: LLMProvider, model: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(
	undefined,
);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
	const [settings, setSettings] = useState<Settings>(() => {
		if (typeof window === "undefined") {
			return {
				openaiApiKey: "",
				anthropicApiKey: "",
				googleApiKey: "",
				deepseekApiKey: "",
				openaiModel: "gpt-4o",
				anthropicModel: "claude-3-5-sonnet-20241022",
				googleModel: "gemini-2.0-flash-exp",
				deepseekModel: "deepseek-chat",
				theme: "auto",
			};
		}
		return getSettings();
	});

	const updateSettings = useCallback((newSettings: Settings) => {
		setSettings(newSettings);
		if (typeof window !== "undefined") {
			saveSettings(newSettings);
		}
	}, []);

	const updateApiKey = useCallback(
		(provider: LLMProvider, apiKey: string) => {
			setSettings((prev) => {
				const key = `${provider}ApiKey` as keyof Settings;
				const updated = { ...prev, [key]: apiKey };
				if (typeof window !== "undefined") {
					saveSettings(updated);
				}
				return updated;
			});
		},
		[],
	);

	const updateModel = useCallback((provider: LLMProvider, model: string) => {
		setSettings((prev) => {
			const key = `${provider}Model` as keyof Settings;
			const updated = { ...prev, [key]: model };
			if (typeof window !== "undefined") {
				saveSettings(updated);
			}
			return updated;
		});
	}, []);

	return (
		<SettingsContext.Provider
			value={{ settings, updateSettings, updateApiKey, updateModel }}
		>
			{children}
		</SettingsContext.Provider>
	);
}

export function useSettings(): SettingsContextValue {
	const context = useContext(SettingsContext);
	if (!context) {
		throw new Error("useSettings must be used within a SettingsProvider");
	}
	return context;
}
