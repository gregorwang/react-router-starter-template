/**
 * Safe localStorage wrapper that handles SSR and errors
 */

export function getItem<T>(key: string, defaultValue: T): T {
	if (typeof window === "undefined") {
		return defaultValue;
	}

	try {
		const item = localStorage.getItem(key);
		if (item === null) {
			return defaultValue;
		}
		return JSON.parse(item) as T;
	} catch (error) {
		console.error(`Error reading localStorage key "${key}":`, error);
		return defaultValue;
	}
}

export function setItem<T>(key: string, value: T): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (error) {
		console.error(`Error setting localStorage key "${key}":`, error);
	}
}

export function removeItem(key: string): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		localStorage.removeItem(key);
	} catch (error) {
		console.error(`Error removing localStorage key "${key}":`, error);
	}
}

export function clearAll(): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		localStorage.clear();
	} catch (error) {
		console.error("Error clearing localStorage:", error);
	}
}
