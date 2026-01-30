import { createContext, useContext, useEffect, useState } from "react";
import type { Settings } from "../lib/llm/types";
import { getSettings, saveSettings } from "../lib/storage/settings-store";

type Theme = "light" | "dark";

interface ThemeContextValue {
	theme: Theme;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<Theme>(() => {
		if (typeof window === "undefined") {
			return "dark";
		}

		const settings = getSettings();
		if (settings.theme === "auto") {
			return window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
		}
		return settings.theme;
	});

	useEffect(() => {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

		const handleMediaChange = () => {
			const settings = getSettings();
			if (settings.theme === "auto") {
				setTheme(mediaQuery.matches ? "dark" : "light");
			}
		};

		mediaQuery.addEventListener("change", handleMediaChange);

		return () => {
			mediaQuery.removeEventListener("change", handleMediaChange);
		};
	}, []);

	useEffect(() => {
		if (theme === "dark") {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	}, [theme]);

	const toggleTheme = () => {
		setTheme((prev) => {
			const newTheme = prev === "light" ? "dark" : "light";
			const settings = getSettings();
			settings.theme = newTheme;
			saveSettings(settings);
			return newTheme;
		});
	};

	return (
		<ThemeContext.Provider value={{ theme, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
