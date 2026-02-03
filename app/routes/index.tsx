import { redirect } from "react-router";
import { requireAuth } from "../lib/auth.server";
import type { Route } from "./+types/index";

// Server-side redirect - faster than client-side useNavigate
export async function loader({ request, context }: Route.LoaderArgs) {
	await requireAuth(request, context.db);
	return redirect("/conversations");
}

// Component won't be rendered due to redirect, but needed for type safety
export default function Index() {
	return null;
}
