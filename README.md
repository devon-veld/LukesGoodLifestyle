# Luke's Good Lifestyle: lukesgoodlifestyle.com

Personal trainer site and supplement shop for Luke Rippon (Pretoria). Static
front-end built from a design export, with Netlify Functions for orders,
Paystack payments, order emails and the admin dashboard. Storage is Netlify
Blobs, so there is no separate database.

## Project layout

```
index.html              The whole app: design template (<x-dc>), app logic, head tags,
                        and the lgl-routes JSON that defines every page URL + SEO copy
support.js              Design runtime that renders index.html's template with React
vendor/                 React 18.3.1 builds (self-hosted, SRI-pinned)
assets/                 WebP images, H.264 videos + poster frames, og-image.jpg
404.html                Branded not-found page, served with a real 404 status
_redirects              API routes, page URLs, old Shopify URL redirects
robots.txt              Crawler rules
build.js                npm run build -> dist/ (one HTML file per page + sitemap.xml)
netlify.toml            Build, functions and response headers
netlify/functions/
  auth.mjs              /api/auth              admin password: first-run setup, login, logout, change
  storeapi.mjs          /api/store             catalog + special bar (GET public, PUT admin)
  orders.mjs            /api/orders            list, ship, delete, send test email (admin)
  checkout.mjs          /api/checkout          server-priced order -> Paystack transaction
  paystack-webhook.mjs  /api/paystack/webhook  charge.success -> mark paid, stock, emails
  paystack-verify.mjs   /api/paystack/verify   return-page check if the webhook is slow
  lib/util.mjs          Blobs store, pricing, scrypt passwords, sessions, rate limit, SMTP email
```

## Pages and URLs

Each page has its own URL, title, description, canonical tag and structured
data. `build.js` writes a separate HTML file per page, so crawlers get the right
head tags before any JavaScript runs; in the browser, links switch pages without
a reload and update the address bar and head tags.

| Page | URL | In sitemap |
|---|---|---|
| Home | `/` | yes |
| Shop | `/shop` | yes |
| Results | `/results` | yes |
| Training plans | `/training` | yes |
| Terms & Conditions | `/terms` | yes |
| Privacy Policy | `/privacy` | yes |
| Shipping Policy | `/shipping` | yes |
| Admin | `/admin` | no (`noindex`) |

To change a page's title or description, edit the `lgl-routes` JSON near the
top of `index.html`. The sitemap is generated from the same list.

Old Shopify URLs (`/products/*`, `/collections/*`, `/policies/*`, `/pages/*`,
`/blogs/*`, `/cart`, `/account`, Shopify sitemaps) redirect permanently (301) to
the closest new page; see `_redirects`. Any other unknown URL gets `404.html`.

## Admin

Footer → **Admin login** (`/admin`).

- First visit ever: create a password (10+ characters). After that: log in.
- 8 wrong attempts from one IP address locks that address out for 15 minutes.
- Passwords are scrypt-hashed; sessions are HMAC-signed httpOnly cookies (7 days).
- Orders: every order, filtered by status and by date (quick ranges or custom
  dates). Click an order for customer details, items, payment reference and
  timeline, with WhatsApp/email buttons, Mark shipped and Delete.
- Dashboard: revenue, prices/sale/stock (updates the shop instantly),
  the yellow special bar, mark shipped, delete orders, change password, sign out,
  and **Send test email**.

Never write the admin password in this repository. The repository is public.

## Environment variables (Netlify → Site configuration → Environment variables)

| Variable | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Live secret key (`sk_live_…`). Turns on card payments and verifies webhooks. |
| `SMTP_PASS` | Password of `luke@lukesgoodlifestyle.com`. Turns on order emails. |
| `SMTP_USER` | Optional. Sending mailbox and From address. Default `luke@lukesgoodlifestyle.com`. |
| `SMTP_HOST` / `SMTP_PORT` | Optional. Default `smtpout.secureserver.net` / `465` (GoDaddy). |
| `ORDER_NOTIFY_EMAIL` | Optional. Where new-order alerts go. Default `luke@lukesgoodlifestyle.com`. |
| `ADMIN_SETUP_CODE` | Optional. Extra code required for first-run password setup. |
| `AUTH_SECRET` | Optional. Fixed session-signing secret (otherwise generated and stored). |

After changing variables: **Deploys → Trigger deploy**.

Paystack Dashboard → Settings → API Keys & Webhooks → **Live Webhook URL**:
`https://lukesgoodlifestyle.com/api/paystack/webhook`

## Payments and emails

Checkout prices the cart on the server, then sends the customer to Paystack's
hosted page. The `charge.success` webhook (or `/api/paystack/verify` when the
customer returns first) marks the order paid, reduces stock and sends:

1. Payment confirmation → customer (items, discount, total, delivery address)
2. New paid order → Luke, with reply-to set to the customer
3. Order shipped → customer, when Luke clicks *Mark shipped*

Emails go through GoDaddy's mail server as `luke@lukesgoodlifestyle.com`. A
failed email never blocks a payment; the admin **Send test email** button shows
the mail server's error. Without `PAYSTACK_SECRET_KEY`, orders are recorded as
unpaid and Luke arranges payment on WhatsApp.

## Performance

- Media ~2.9MB total. Images are WebP at display size; result photos lazy-load.
- Videos: H.264, 30fps, 480p, `+faststart`, ~8KB posters. They start buffering
  after the page loads when within ~1.5 screens, and pause off-screen.
- React is self-hosted and preloaded; fonts use `display=swap`, and the
  handwriting font is subset to the letters in "I'm Luke".

## SEO

- Per page: title, description, canonical, `hreflang`, Open Graph and Twitter
  tags, robots directive, JSON-LD (HealthClub everywhere, Products on `/` and
  `/shop`, FAQ on `/training`).
- `sitemap.xml` (generated) and `robots.txt`.
- Google Tag Manager: replace `GTM-XXXXXXX` in `index.html` with the real
  container ID. Until then nothing loads.

## Domain (lukesgoodlifestyle.com)

The domain and Luke's mailbox are at GoDaddy.

1. Netlify → Domain management → **Add a domain** → `lukesgoodlifestyle.com`,
   and add `www.lukesgoodlifestyle.com`. Set `lukesgoodlifestyle.com` as the
   **primary domain** (the netlify.app and www addresses then redirect to it).
2. GoDaddy → DNS: change **only** these two records:
   - `A` record for `@` → `75.2.60.5` (replaces Shopify's `23.227.38.32`)
   - `CNAME` for `www` → `lukesgoodlifestyle.netlify.app` (replaces `shops.myshopify.com`)

   Do not move the nameservers and do not touch the MX or TXT (SPF) records;
   Luke's mailbox and the order emails depend on them.
3. Netlify issues the HTTPS certificate automatically once DNS resolves.
4. In Shopify, remove the domain (Settings → Domains) so it stops claiming it.
5. Google Search Console: add the domain property, then submit
   `https://lukesgoodlifestyle.com/sitemap.xml`.

## Local development

`npm run build` writes `dist/`. Plain static servers ignore `_redirects`, so use
the Netlify CLI (`npx netlify dev`) to run pages, redirects and functions together.
Every push to `main` deploys.

Contact: WhatsApp 073 028 3066 · @lukesgoodlifestyle
