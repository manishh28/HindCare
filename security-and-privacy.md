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

## Before publishing

1. Run `git status` and confirm `.env`, database files, exports, uploads, and patient data are not listed.
2. Search the files being committed for key names and real personal information.
3. Use a private repository for company work unless the project owner explicitly approves public access.
