import { useState } from "react";
import { cn } from "../../lib/utils/cn";

interface ApiKeyInputProps {
	value: string;
	onChange: (value: string) => void;
	label: string;
	className?: string;
}

export function ApiKeyInput({
	value,
	onChange,
	label,
	className,
}: ApiKeyInputProps) {
	const [showKey, setShowKey] = useState(false);
	const [isFocused, setIsFocused] = useState(false);

	const displayValue = showKey ? value : maskKey(value);

	function maskKey(key: string): string {
		if (!key) return "";
		if (key.length <= 8) return "••••••••";
		return `${key.slice(0, 4)}${"•".repeat(16)}${key.slice(-4)}`;
	}

	return (
		<div className={cn("space-y-2", className)}>
			<label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
				{label}
			</label>
			<div className="relative">
				<input
					type={showKey ? "text" : "password"}
					value={displayValue}
					onChange={(e) => onChange(e.target.value)}
					onFocus={() => setIsFocused(true)}
					onBlur={() => setIsFocused(false)}
					className={cn(
						"w-full px-4 py-3 rounded-lg border transition-colors",
						isFocused
							? "border-orange-500 ring-2 ring-orange-500 ring-opacity-20"
							: "border-gray-300 dark:border-gray-700",
						"bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:outline-none",
					)}
					placeholder="•••• •••• •••• ••••"
				/>
				{value && (
					<button
						type="button"
						onClick={() => setShowKey(!showKey)}
						className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
					>
						{showKey ? (
							<svg
								className="w-5 h-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
								/>
							</svg>
						) : (
							<svg
								className="w-5 h-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
								/>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
								/>
							</svg>
						)}
					</button>
				)}
			</div>
		</div>
	);
}
