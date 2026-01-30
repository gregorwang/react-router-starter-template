import { cn } from "../../lib/utils/cn";

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "default" | "ghost" | "outline" | "danger";
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
		default: "bg-orange-500 hover:bg-orange-600 text-white",
		ghost: "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300",
		outline: "border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800",
		danger: "bg-red-500 hover:bg-red-600 text-white",
	};

	const sizes = {
		default: "px-4 py-2",
		sm: "px-3 py-1.5 text-sm",
		lg: "px-6 py-3 text-lg",
		icon: "p-2",
	};

	return (
		<button
			className={cn(
				"inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed",
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
