import type { Route } from "./+types/conversations.delete";
import { deleteConversation } from "../lib/db/conversations.server";
import { redirect } from "react-router";

export async function action({ request, context }: Route.ActionArgs) {
    if (request.method !== "DELETE") {
        return new Response("Method not allowed", { status: 405 });
    }

    const formData = await request.formData();
    const conversationId = formData.get("conversationId") as string;
    const projectId = formData.get("projectId") as string | null;

    if (!conversationId) {
        return new Response("Conversation ID is required", { status: 400 });
    }

    await deleteConversation(context.db, conversationId);

    // Redirect to new chat if we deleted the current one, or just back to conversations
    // We'll let the client handle navigation if needed, but for now redirect to home/new
    return redirect(projectId ? `/c/new?project=${projectId}` : "/c/new");
}
