import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | boolean | undefined | null)[]): string {
	return twMerge(clsx(inputs));
}
