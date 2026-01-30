import { useSettings as useSettingsContext } from "../contexts/SettingsContext";

export function useSettings() {
	return useSettingsContext();
}
