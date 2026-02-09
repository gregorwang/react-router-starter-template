import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useState,
} from "react";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "theme";

function isTheme(value: unknown): value is Theme {
	return value === "light" || value === "dark";
}

function readStoredTheme(): Theme | null {
	try {
		const stored = localStorage.getItem(THEME_STORAGE_KEY);
		return isTheme(stored) ? stored : null;
	} catch {
		return null;
	}
}

function writeStoredTheme(theme: Theme) {
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// Ignore storage failures (private mode, quota, policy restrictions).
	}
}

function prefersDarkScheme() {
	try {
		return window.matchMedia("(prefers-color-scheme: dark)").matches;
	} catch {
		return false;
	}
}

function prefersReducedMotion() {
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

function runThemeTransition(targetTheme: Theme) {
	if (typeof window === "undefined" || typeof document === "undefined") return;
	if (prefersReducedMotion()) return;
	const root = document.documentElement;
	root.classList.remove("theme-corner-transition-dark", "theme-corner-transition-light");
	// Force reflow so repeated toggles retrigger the animation class.
	void root.offsetWidth;
	root.classList.add(
		targetTheme === "dark"
			? "theme-corner-transition-dark"
			: "theme-corner-transition-light",
	);
	window.setTimeout(() => {
		root.classList.remove("theme-corner-transition-dark", "theme-corner-transition-light");
	}, 620);
}

function getInitialTheme(): Theme {
	if (typeof window === "undefined") {
		return "dark";
	}
	const stored = readStoredTheme();
	if (stored) {
		return stored;
	}
	return prefersDarkScheme() ? "dark" : "light";
}

const useSafeLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ThemeContextValue {
	theme: Theme;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<Theme>(getInitialTheme);

	useEffect(() => {
		let mediaQuery: MediaQueryList | null = null;
		try {
			mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		} catch {
			mediaQuery = null;
		}
		if (!mediaQuery) return;

		const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
			if (!readStoredTheme()) {
				setTheme(e.matches ? "dark" : "light");
			}
		};

		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", handleMediaChange);
			return () => mediaQuery?.removeEventListener("change", handleMediaChange);
		}

		mediaQuery.addListener(handleMediaChange);
		return () => mediaQuery?.removeListener(handleMediaChange);
	}, []);

	useSafeLayoutEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
	}, [theme]);

	const toggleTheme = () => {
		const nextTheme = theme === "light" ? "dark" : "light";
		runThemeTransition(nextTheme);
		writeStoredTheme(nextTheme);
		setTheme(nextTheme);
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
