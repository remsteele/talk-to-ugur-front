# talk-to-ugur-front

Frontend for the **talk to ugur** backend. Single-page React chat UI with SSE streaming.

## requirements

- Node.js 18+ (or Docker)
- Backend running on `http://localhost:8000`

## setup (local)

```bash
npm install
npm run dev
```

App runs on `http://localhost:3000`.

## environment

Set the API base URL with `VITE_API_BASE_URL` (defaults to `http://localhost:8000`).

Example:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

## docker

```bash
docker compose build
docker compose up
```

## streaming

The UI uses SSE streaming:

`POST /api/v1/chat/messages?stream=true`

Events handled:
- `meta` (JSON: `visitor_id`, `thread_id`, `user_message`, `emotion`)
- `token` (raw text chunks)
- `done` (JSON: `assistant_message`)
- `error` (string)

## structure

- `src/App.jsx` — main UI + chat logic
- `src/styles.css` — styles
- `vite.config.js` — Vite config
- `docker-compose.yml` — container setup
- `Dockerfile` — build image
