# prj-campus-backend

Express and Supabase backend for PRJ Campus/Buzz.

## Quick Start

```bash
npm install
npm test
npm start
```

Copy `.env.example` to `.env` for local development and set the Supabase, Cloudinary, Gemini, JWT, and client URL values.

## Deployment Notes

- Apply `supabase/migration.sql` in the Supabase SQL editor before using the production backend.
- Deploy with Vercel using the environment variables listed in `.env.example`.
- Admin endpoints live under `/api/admin/*` and require an authenticated admin JWT.
