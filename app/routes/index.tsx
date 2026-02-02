import { redirect } from "react-router";
import type { Route } from "./+types/index";

// Server-side redirect - faster than client-side useNavigate
export function loader({ }: Route.LoaderArgs) {
	return redirect("/conversations");
}

// Component won't be rendered due to redirect, but needed for type safety
export default function Index() {
	return null;
}
