# Security and privacy notes

## Keep secrets out of Git

- Store API keys and database connection strings in `backend/.env` or in the deployment platform's secret settings.
- Commit only `backend/.env.example` with empty values.
- Never place private API keys in `frontend/app.js` or any other browser-served file.
- If a key is committed accidentally, revoke it and create a replacement immediately. Removing the file later does not remove it from Git history.

## Keep personal data out of the repository

- Do not commit patient names, phone numbers, addresses, medical details, live locations, or booking exports.
- Store runtime databases under `database/` with a `.db`, `.sqlite`, or `.sqlite3` extension, or under `backend/data/`; these paths are ignored by Git.
- Use fictional records in `database/seed.sql` and the in-memory demo data.
- Production data should live in a protected database with access control, backups, and audit logging.

## The demo role switcher is not authentication

The frontend's role dropdown and the API's `X-Demo-Role` header exist only to preview what role-gated actions (approving a hospital, changing an ambulance's status, advancing a booking) will look like once real accounts exist. There is:

- No password or token check.
- No way to verify who is actually sending the header — anyone can set it to `admin` with a browser dev tool or a raw HTTP request.
- No session or expiry.

**Do not treat any endpoint gated by `X-Demo-Role` as access-controlled.** Before this moves past a local prototype, replace it with real authentication backed by the `users` table in `database/schema.sql` (hashed passwords, sessions or tokens, and server-side role checks tied to a verified identity) and re-audit every `PATCH` route.

## CORS

`backend/server.js` reads `ALLOWED_ORIGINS` from the environment (comma-separated). It defaults to `*` so the local demo works with zero configuration. Before deploying anywhere reachable by other people, set `ALLOWED_ORIGINS` to the exact origin(s) the frontend is served from.

## Before publishing

1. Run `git status` and confirm `.env`, database files, exports, uploads, and patient data are not listed.
2. Search the files being committed for key names and real personal information.
3. Confirm `ALLOWED_ORIGINS` is not left as `*` for anything beyond local development.
4. Use a private repository for company work unless the project owner explicitly approves public access.
