import { cn } from "../../lib/utils/cn";

interface SendButtonProps {
	disabled?: boolean;
	onClick?: () => void;
}

export function SendButton({ disabled, onClick }: SendButtonProps) {
	return (
		<button
			type="submit"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"p-2 rounded-lg transition-colors",
				disabled
					? "text-gray-400 cursor-not-allowed"
					: "text-orange-500 hover:bg-gray-100 dark:hover:bg-gray-700",
			)}
		>
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
					d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
				/>
			</svg>
		</button>
	);
}
