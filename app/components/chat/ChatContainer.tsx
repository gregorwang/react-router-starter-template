import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { StreamingIndicator } from "./StreamingIndicator";
import { cn } from "../../lib/utils/cn";

interface ChatContainerProps {
	className?: string;
}

export function ChatContainer({ className }: ChatContainerProps) {
	return (
		<div className={cn("flex flex-col flex-1 h-full", className)}>
			<div className="flex-1 overflow-y-auto">
				<MessageList />
			</div>
			<div className="border-t border-gray-200 dark:border-gray-800 p-4">
				<InputArea />
				<StreamingIndicator />
			</div>
		</div>
	);
}
