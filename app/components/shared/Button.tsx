import { cn } from "../../lib/utils/cn";

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "default" | "ghost" | "outline" | "soft" | "danger";
	size?: "default" | "sm" | "lg" | "icon";
	children: React.ReactNode;
}

export function Button({
	variant = "default",
	size = "default",
	className,
	children,
	...props
}: ButtonProps) {
	const variants = {
		default:
			"bg-brand-600 text-white shadow-sm shadow-brand-600/30 hover:bg-brand-500 hover:shadow-brand-500/40 active:bg-brand-700",
		ghost:
			"text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60",
		outline:
			"border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 text-neutral-700 dark:text-neutral-200 hover:border-brand-400/60 hover:bg-brand-50/70 dark:hover:bg-neutral-800/60",
		soft:
			"border border-brand-500/60 text-brand-700 dark:text-brand-200 hover:bg-brand-50/80 dark:hover:bg-brand-900/30",
		danger:
			"bg-rose-600 text-white shadow-sm shadow-rose-600/30 hover:bg-rose-500 active:bg-rose-700",
	};

	const sizes = {
		default: "px-4 py-2 text-sm",
		sm: "px-3 py-2 text-xs",
		lg: "px-6 py-4 text-base",
		icon: "p-2",
	};

	return (
		<button
			className={cn(
				"inline-flex items-center justify-center rounded-xl font-semibold tracking-tight transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
				variants[variant],
				sizes[size],
				className,
			)}
			{...props}
		>
			{children}
		</button>
	);
}
