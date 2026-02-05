# Repository Guidelines

## Project Structure & Module Organization
- `app/` contains the React Router app. Key areas: `app/routes/` for file-based routes, `app/components/`, `app/contexts/`, `app/hooks/`, `app/lib/`, plus entry files `app/entry.client.tsx`, `app/entry.server.tsx`, `app/root.tsx`, and route config in `app/routes.ts`.
- `public/` holds static assets served as-is.
- `workers/` contains the Cloudflare Worker entry (`workers/app.ts`).
- Build artifacts live in `build/`; generated React Router output in `.react-router/`; local Wrangler state in `.wrangler/`.
- Cloudflare bindings and runtime config are defined in `wrangler.json`, with local-only values in `.dev.vars`.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start the dev server with HMR at `http://localhost:5173`.
- `npm run build`: create a production build via React Router.
- `npm run preview`: build and preview the production bundle with Vite.
- `npm run deploy`: deploy the Worker using Wrangler.
- `npm run cf-typegen`: generate Cloudflare + React Router type bindings.
- `npm run check`: run `tsc`, build, and a `wrangler deploy --dry-run` sanity check.
- `npm run typecheck`: run type generation and `tsc -b` for full type validation.

## Coding Style & Naming Conventions
- TypeScript + React Router 7 with ESM; keep imports organized and prefer named exports.
- Follow existing formatting: tabs for indentation and double quotes for strings.
- Route modules live in `app/routes/` and should follow React Router?s file-based naming (e.g., `app/routes/_index.tsx`).
- Tailwind CSS is enabled; keep global styles in `app/app.css`.
- No lint/format tool is configured, so match nearby code style.

## Testing Guidelines
- No test framework is set up yet and there is no `tests/` directory.
- For now, rely on `npm run check` and `npm run typecheck` before shipping.
- If you add tests, use a clear convention such as `*.test.ts` / `*.test.tsx` and document the runner in this file.

## Commit & Pull Request Guidelines
- Recent commits use Conventional Commits like `feat:` and `refactor:`; follow that pattern.
- Keep messages short and imperative (e.g., `feat: add streaming response UI`).
- PRs should include a summary, the commands you ran, and screenshots for UI changes.
- Note any updates to Cloudflare bindings or environment variables.

## Security & Configuration Tips
- Store secrets only in `.dev.vars` or CI secrets; do not commit real credentials.
- Update `wrangler.json` when adding Worker bindings (D1, KV, vars) and re-run typegen.
