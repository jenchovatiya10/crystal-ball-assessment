# Crystal Ball Assessment

npm-workspaces monorepo for the Crystal Ball Wave 2 Senior Fullstack Developer assessment.

## Structure

```
apps/web          Next.js App Router frontend
apps/api          Express + Node API
packages/shared   Shared Zod schemas and types
docs/             Project documentation
```

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
npm install
cp .env.example .env
npm run build -w @crystal-ball/shared
```

Build `@crystal-ball/shared` once after install so workspace imports resolve to `dist/`.

Root scripts that need shared (`dev`, `build`, `test`, `lint`, `typecheck`) build it first automatically.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Build shared, then run API + web together |
| `npm run build` | Build shared → api → web |
| `npm run test` | Build shared, then run all workspace tests |
| `npm run test:api` | API tests (Jest + Supertest) |
| `npm run test:web` | Web tests (Vitest + RTL) |
| `npm run lint` | Typecheck-based lint across workspaces |
| `npm run typecheck` | Strict TypeScript checks across workspaces |

## Workspace packages

- `@crystal-ball/web` — frontend (Next.js, React, Zustand, Tailwind, Vitest)
- `@crystal-ball/api` — backend (Express, Jest, Supertest, Zod)
- `@crystal-ball/shared` — shared Zod schemas/types

## Notes

Foundation scaffolding only. Feature work (AI, modes, streaming, RAG, etc.) is intentionally not included yet.
# crystal-ball-assessment
