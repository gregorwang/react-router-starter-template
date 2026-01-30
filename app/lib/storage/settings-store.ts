import type { Settings, DEFAULT_SETTINGS } from "../llm/types";
import { getItem, setItem } from "./local-storage";

const SETTINGS_KEY = "llm_settings";

export function getSettings(): Settings {
	return getItem<Settings>(SETTINGS_KEY, {
		openaiApiKey: "",
		anthropicApiKey: "",
		googleApiKey: "",
		deepseekApiKey: "",
		openaiModel: "gpt-4o",
		anthropicModel: "claude-3-5-sonnet-20241022",
		googleModel: "gemini-2.0-flash-exp",
		deepseekModel: "deepseek-chat",
		theme: "auto",
	});
}

export function saveSettings(settings: Settings): void {
	setItem(SETTINGS_KEY, settings);
}

export function updateSetting<K extends keyof Settings>(
	key: K,
	value: Settings[K],
): void {
	const settings = getSettings();
	settings[key] = value;
	saveSettings(settings);
}
