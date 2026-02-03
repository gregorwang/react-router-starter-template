import type { Route } from "./+types/logout";
import { redirect } from "react-router";
import { buildLogoutCookie, destroySession } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
	await destroySession(request, context.db);
	return redirect("/login", {
		headers: {
			"Set-Cookie": buildLogoutCookie(request),
		},
	});
}

export async function loader({ request, context }: Route.LoaderArgs) {
	await destroySession(request, context.db);
	return redirect("/login", {
		headers: {
			"Set-Cookie": buildLogoutCookie(request),
		},
	});
}

export default function Logout() {
	return null;
}
