# Project instructions

This is a single-owner Zhang Jie fan archive with a private owner workspace and an anonymous, read-only visitor selection. The owner confirmed 2009 as the start year. Only records explicitly marked public and not in draft, and media directly referenced by those records, may be read without login. Private notes, rights evidence, account data, uploads, edits, settings changes, backups and unselected media require server-side owner authentication. Never fabricate artist facts, personal memories, or media records. Publishing and withdrawing selections must work in both local SQLite and real Supabase mode; keep Storage buckets private and do not expose long-lived media signing access to anonymous users.

Local mode uses a real SQLite database and media files. Supabase is an optional separately configured provider. Do not equate local or simulated database tests with successful live Supabase validation.

Keep passwords, session tokens, `.data`, environment files, private exports, and test databases out of source control. Do not fetch unlicensed artist media to populate the UI.

When delegating clear, narrowly scoped, repeatable, or high-volume work, use `luna_worker`. For complex, ambiguous, multi-step, cross-cutting, or high-risk work, use `sol_complex`. Do not use other agent types unless the user explicitly requests them. Give each agent clear file ownership and preserve others' changes.

Read the relevant guides in `node_modules/next/dist/docs` before changing Next.js behavior. Run type checks, lint, targeted tests, and a production build for substantive changes. Preserve UTF-8 Chinese copy and inspect desktop and mobile rendering.
