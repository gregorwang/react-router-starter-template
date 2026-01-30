# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` - Start development server with HMR at http://localhost:5173
- `npm run build` - Create production build
- `npm run preview` - Preview production build locally
- `npm run typecheck` - Run typecheck after generating types
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run check` - Full check: TypeScript + build + dry-run deploy
- `npm run cf-typegen` - Generate types for Cloudflare bindings in wrangler.json

## Architecture

This is a React Router 7 application running on Cloudflare Workers. The key architectural pieces:

### App Structure (`app/`)
- **routes.ts** - Route configuration using React Router's route config API
- **root.tsx** - Root layout with HTML structure, links, and error boundary
- **routes/** - Route components with loaders and data loading
- **welcome/** - Reusable components

### React Router 7 Patterns
- Routes define both component and loader/mutation functions in the same file
- Type-safe route props come from generated `+types/` files (e.g., `import type { Route } from "./+types/home"`)
- Server-side rendering is enabled by default (configured in react-router.config.ts)

### Cloudflare Integration (`workers/app.ts`)
The entry point for Cloudflare Workers that:
- Extends the `AppLoadContext` interface to expose Cloudflare `env` and `ctx`
- Creates a request handler using the virtual React Router server build
- Forwards requests to React Router with Cloudflare context

### Cloudflare Bindings
Environment variables and bindings are defined in `wrangler.json`. Access them in loaders via `context.cloudflare.env.YOUR_BINDING`. After modifying wrangler.json, run `npm run cf-typegen` to regenerate types.

### Styling
Uses Tailwind CSS 4 with the Vite plugin (@tailwindcss/vite). Styles are imported at root level (see app.css import in root.tsx).
