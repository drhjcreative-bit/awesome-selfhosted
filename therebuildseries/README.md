# The Rebuild Series — website

Single-file static site for **therebuildseries.com**, the home of The Rebuild
Series workbooks (Vol 01 *Quiet the Critic*, Vol 06 *Built, Not Born*).

- `index.html` — the whole site. No build step, no dependencies (only Google
  Fonts loaded at runtime).
- `CNAME` — for GitHub Pages custom-domain hosting (see below).

## Add your buy links

Search `index.html` for `TODO` — there are two `href="#"` buy buttons, one per
volume. Paste each book's Amazon listing URL there.

## Preview

While this branch/repo deploys through the existing Pages workflow, the site is
served at `/rebuild/` on the project Pages URL
(`https://<owner>.github.io/awesome-selfhosted/rebuild/`).

## Pointing therebuildseries.com at it

GitHub Pages supports **one custom domain per site**, and this repo's Pages
site is already used by the visual lab. To put the domain on this page, host
this folder as its own site. Two easy options:

1. **Separate GitHub repo + Pages** — create a repo (e.g. `therebuildseries`),
   copy `index.html` and `CNAME` into it, enable Pages (deploy from branch),
   then in your DNS add:
   - `A` records for the apex `therebuildseries.com` → GitHub Pages IPs
     (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`)
   - `CNAME` record for `www` → `<owner>.github.io`
   Then set the custom domain in the repo's Pages settings and enable HTTPS.

2. **Netlify / Cloudflare Pages** — drag-and-drop this folder, then add
   `therebuildseries.com` as a custom domain in their dashboard and follow
   their DNS instructions.
