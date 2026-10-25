# READBOOKS – read with me

Upload a PDF book, read it, bookmark your place, and pick up where you left off on any device.

This folder is the complete website plus the database setup. It is **not live yet**: you connect it to your own free Supabase project (accounts, database, private file storage) and publish it on a free host. No coding is needed; about 30 minutes.

## What you need
- A free account at **supabase.com**
- A free account at **netlify.com** (or Cloudflare Pages / Vercel) and a free account at **github.com**

## Step 1 – Create the Supabase project
1. In Supabase press **New project**, give it a name (for example READBOOKS), choose a strong database password and save it in a password manager.
2. Open **SQL Editor → New query**, paste the whole of `schema.sql` from this folder, and press **Run**. It should say "Success". This creates the tables, the privacy rules (each reader can reach only their own data) and the private file storage.
3. Open **Authentication → Providers → Email**: keep **Confirm email** switched ON. Optionally raise the minimum password length to 8 or more.
4. Open **Authentication → URL Configuration**: set **Site URL** to your live address once you have it (Step 4) and add it under **Redirect URLs** too. Without this, verification and password-reset links won't come back to your site.
5. Email sending: Supabase's built-in email is limited to a few messages per hour. Before real readers use the site, add your own email service under **Authentication → SMTP Settings**.

## Step 2 – Add the "delete my account" function
This one needs the Supabase command line, installed once from supabase.com/docs/guides/cli.
1. In a terminal in this folder run `supabase login`, then `supabase link --project-ref YOUR_PROJECT_REF` (the reference is in Project Settings → General).
2. Run `supabase functions deploy delete-account`.
3. Run `supabase secrets set SITE_ORIGIN=https://YOUR-LIVE-ADDRESS` (after Step 4).

## Step 3 – Find your two public settings
Supabase → **Project Settings → API**. Copy:
- **Project URL** → this becomes `SUPABASE_URL`
- **anon public key** → this becomes `SUPABASE_ANON_KEY`

The anon key is *meant* to be public; the database rules in `schema.sql` are what protect the data. **Never** use the `service_role` key anywhere on the website. The build refuses to continue if you paste it by mistake.

## Step 4 – Publish the website
1. Put this folder in a new GitHub repository.
2. In Netlify press **Add new site → Import from Git** and pick the repository.
3. Build command: `npm install && npm run build`. Publish directory: `.` (a single dot).
4. In **Site settings → Environment variables** add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Step 3). Redeploy.
5. Netlify gives you a secure https address. Go back to Supabase Step 1.4 and Step 2.3 and enter that address.
6. To use your own domain name, open **Domain management → Add a domain** in Netlify and follow the prompts. HTTPS is automatic.

The `_headers` file turns on the security headers (HTTPS only, a strict Content-Security-Policy, and more). On Cloudflare Pages the same `_headers` file works. On Vercel, copy the same values into a `vercel.json` `headers` section.

## Being the owner
The **first account ever created** becomes the owner. Create it yourself right after publishing, before sharing the link. Signed in as owner you will see **Owner area**, where you fill in the terms, privacy policy, how long things are kept, support contact and business contact. Until you do, the site shows "Information to be provided by the business owner." The owner can see how many accounts exist but can never see readers' books, bookmarks or history.

## Backup and restore
- Database: Supabase → **Database → Backups** (daily backups on paid plans). On the free plan, export regularly: **Table Editor → each table → Export as CSV**.
- Files: Supabase → **Storage → books**. Readers' files are in one folder per reader.
- To restore into a new project, repeat Steps 1–4 and re-import the CSV files.

## Limits to know about
- PDFs up to 50 MB, one file per upload. Password-protected PDFs can't be opened yet.
- Free Supabase plans have storage, bandwidth and email limits; check supabase.com/pricing.
- The server checks the file's type label and size (the bucket accepts only `application/pdf` up to 50 MB). The "is it really a PDF" content check, and the page count, happen in the reader's browser before upload. A determined person could upload a non-PDF labelled as PDF into **their own private folder**; it can't reach anyone else and simply won't open.
- Sign-in attempts and password resets are throttled by Supabase Auth; uploads are limited by the database to 20 per hour per person.
- Inline styles are allowed by the Content-Security-Policy (needed for progress bars); scripts are limited to this site's own files.

## What is not built
Blockchain (you chose "curious but not sure yet"). Payments (none requested).

## Settings and secrets list
| Where | Name | What it is | Secret? |
|---|---|---|---|
| Netlify environment | `SUPABASE_URL` | Your project address | No |
| Netlify environment | `SUPABASE_ANON_KEY` | Public key, limited by database rules | No |
| Supabase function secrets | `SITE_ORIGIN` | Your live website address | No |
| Supabase (automatic) | `SUPABASE_SERVICE_ROLE_KEY` | Powerful key used only inside the delete function | **Yes. Never share or put it on the website.** |
