import { useTheme as useThemeContext } from "../contexts/ThemeContext";

export function useTheme(): ReturnType<typeof useThemeContext> {
	return useThemeContext();
}
