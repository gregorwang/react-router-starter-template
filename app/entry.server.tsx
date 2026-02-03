import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	let shellRendered = false;
	const userAgent = request.headers.get("user-agent");

	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} />,
		{
			onError(error: unknown) {
				responseStatusCode = 500;
				// Log streaming rendering errors from inside the shell.  Don't log
				// errors encountered during initial shell rendering since they'll
				// reject and get logged in handleDocumentRequest.
				if (shellRendered) {
					console.error(error);
				}
			},
		},
	);
	shellRendered = true;

	// Ensure requests from bots and SPA Mode renders wait for all content to load before responding
	// https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
	if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
		await body.allReady;
	}

	const csp = [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"font-src 'self' https://fonts.gstatic.com data:",
		"img-src 'self' data:",
		"connect-src 'self'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");

	responseHeaders.set("Content-Type", "text/html");
	responseHeaders.set("Content-Security-Policy", csp);
	responseHeaders.set("X-Content-Type-Options", "nosniff");
	responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
	responseHeaders.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
	responseHeaders.set("X-Frame-Options", "DENY");
	if (new URL(request.url).protocol === "https:") {
		responseHeaders.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
	}
	responseHeaders.set("Cache-Control", "no-store");
	return new Response(body, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
