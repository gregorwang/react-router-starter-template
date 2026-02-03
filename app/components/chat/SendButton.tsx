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
				"p-2 rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 active:scale-[0.98]",
				disabled
					? "text-neutral-400 cursor-not-allowed"
					: "text-brand-600 hover:bg-brand-50/80 dark:hover:bg-neutral-800/60",
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
