import { createContext, useContext, useEffect, useState } from "react";


type Theme = "light" | "dark";

interface ThemeContextValue {
	theme: Theme;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<Theme>("dark");

	useEffect(() => {
		const stored = localStorage.getItem("theme") as Theme | null;
		if (stored) {
			setTheme(stored);
		} else {
			const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
			setTheme(isDark ? "dark" : "light");
		}
	}, []);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleMediaChange = (e: MediaQueryListEvent) => {
			if (!localStorage.getItem("theme")) {
				setTheme(e.matches ? "dark" : "light");
			}
		};

		mediaQuery.addEventListener("change", handleMediaChange);
		return () => mediaQuery.removeEventListener("change", handleMediaChange);
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
			localStorage.setItem("theme", newTheme);
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
