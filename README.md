# Luke's Good Lifestyle — lukesgoodlifestyle.com

The production site: static design front-end + Netlify Functions backend
(orders, payments, emails, admin auth) on Netlify Blobs storage.

## Architecture

```
index.html            the design (data-driven single page: home/shop/results/training/admin)
support.js            design runtime
assets/               WebP images (smart-cropped), 720p videos + posters, og-image
build.js              npm run build -> copies site into dist/
netlify/functions/
  auth.mjs            /api/auth      admin password: first-run setup, login, logout, change
  storeapi.mjs        /api/store     GET catalog+special (public) · PUT updates (admin)
  orders.mjs          /api/orders    GET list · ship / delete (admin)
  checkout.mjs        /api/checkout  server-priced order -> Paystack transaction (or manual fallback)
  paystack-webhook.mjs /api/paystack/webhook  charge.success -> mark paid, stock, emails
  paystack-verify.mjs  /api/paystack/verify   success-page fallback: verify reference -> mark paid
  lib/util.mjs        blobs (strong consistency), scrypt, sessions, rate-limit, SMTP email, pricing, markOrderPaid
```

**Storage:** Netlify Blobs (store `lgl`) — catalog/special, orders, password hash,
session secret, login-fail counters. No external database needed.

## Admin (`Admin login` link in the footer)

- First visit ever: **create password** (min 10 chars) → signed in.
- After that: password login. 8 wrong attempts = 15-minute lockout.
- Sessions: HMAC-signed token, httpOnly/Secure/SameSite=Strict cookie, 7 days.
- Passwords: scrypt-hashed (never stored in plain text).
- Dashboard: revenue + orders (live), edit prices/sale/stock (updates the shop
  instantly), publish/toggle the yellow special bar, mark orders shipped,
  delete orders, **change password**, sign out.

> **HANDOVER:** the current admin password is `GoodGold2026!Train` (set during
> testing). Log in and change it in the Account panel immediately — after that,
> only Luke knows it.

## Go-live checklist (Netlify → Site configuration → Environment variables)

| Variable | Purpose | Where to get it |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Enables real card payments (`sk_live_…`). The webhook is verified with this same key — no separate webhook secret. | Paystack Dashboard → Settings → API Keys & Webhooks |
| `SMTP_PASS` | Password of the `luke@lukesgoodlifestyle.com` mailbox. Turns on order emails. | GoDaddy email login |
| `SMTP_USER` | optional: mailbox that sends (and the From address). Default `luke@lukesgoodlifestyle.com` | — |
| `SMTP_HOST` / `SMTP_PORT` | optional: default `smtpout.secureserver.net` / `465` (GoDaddy) | — |
| `ORDER_NOTIFY_EMAIL` | optional: where new-order alerts go. Default `luke@lukesgoodlifestyle.com` | — |
| `ADMIN_SETUP_CODE` | optional: extra code required for first-run password setup | choose any value |
| `AUTH_SECRET` | optional: fixed session-signing secret (else auto-generated) | any long random string |

After adding variables: **Deploys → Trigger deploy** so functions pick them up.

**Paystack webhook:** Paystack Dashboard → Settings → API Keys & Webhooks → set
**Live Webhook URL** to `https://lukesgoodlifestyle.com/api/paystack/webhook`
(set the **Test Webhook URL** to the same if testing with an `sk_test_…` key).
Paystack signs each event with HMAC-SHA512 of the secret key; unsigned or
mis-signed events are rejected with 401.

### Payment behaviour
- **With `PAYSTACK_SECRET_KEY`:** checkout → Paystack hosted payment page (ZAR)
  → the `charge.success` webhook marks the order *Pending (paid)*, decrements
  stock, emails the customer a confirmation and Luke a "new PAID order" alert.
  Paystack then returns the customer to the site (`/?payment=success&order=…`),
  where the page calls `/api/paystack/verify` with the reference as a
  belt-and-braces check — if the webhook hasn't arrived yet, verify marks the
  order paid itself (both paths are idempotent).
- **Without it (current):** orders are recorded as manual/unpaid, stock is
  reserved, both emails still send (once `SMTP_PASS` is set), and Luke arranges
  payment on WhatsApp. The site is fully usable pre-Paystack.

### Order emails (SMTP, from luke@lukesgoodlifestyle.com)
Sent by the Netlify Functions through GoDaddy's mail server, signed in as
`luke@lukesgoodlifestyle.com`.
1. Payment confirmed → customer: items, quantities, discount, total, delivery address
2. New paid order → Luke (`ORDER_NOTIFY_EMAIL`), with reply-to set to the customer
3. Order shipped → customer (when Luke clicks *Mark shipped*)

Admin → Account → **Send test email** sends a sample to Luke's inbox and shows
the mail server's error if sending fails. If Luke changes the mailbox password,
update `SMTP_PASS` in Netlify and redeploy, or order emails stop.

## Performance
- Total media ~2.9MB (from 45MB originally). Images are WebP sized to their
  display size; videos are H.264, 30fps, 480p (640x360 for work-1), CRF 32,
  `+faststart`, no audio, each 0.4-0.8MB with an ~8KB poster frame.
- Videos: nothing video-related blocks first paint. After the page `load`
  event, any video within ~1.5 screens starts buffering (skipped on Data
  Saver), so it is already playing when it scrolls into view; off-screen
  videos pause. The hero's blurred backdrop is a still frame, not a second
  video decode.
- React 18.3.1 is self-hosted in `vendor/` (same SRI hashes as the runtime
  expects), preloaded, and cached for a year. No third-party script origins.
- Fonts: Anton + Archivo via Google Fonts with `display=swap`; Caveat is
  requested only for the glyphs in "I'm Luke".
- Result photos smart-cropped (face detection) to the exact 3:4 display ratio.
- Tested in real Chrome on a throttled 4G profile: every video plays within
  ~0.5s of scrolling to it, on desktop and mobile.

## SEO
- Title/description/canonical, Open Graph + Twitter cards (`assets/og-image.jpg`),
  JSON-LD (HealthClub, both Products, FAQ), `robots.txt`, `sitemap.xml`.
- **GTM:** edit `window.GTM_ID` in `index.html` (search `GTM-XXXXXXX`) to enable
  analytics — it stays inert until a real ID is set, and loads after `load`.
- All URLs already point at `https://lukesgoodlifestyle.com`. Once DNS is
  live, submit the sitemap in Google Search Console.

## Domain cutover (lukesgoodlifestyle.com)
> Note: the domain currently serves the old Shopify site — switching DNS
> replaces it with this site. Do this as a deliberate cutover with Luke.
1. Netlify → Domain management → **Add a domain** → `lukesgoodlifestyle.com`
   → set it as the **primary domain** (netlify.app then auto-redirects).
2. At GoDaddy (where the domain and Luke's email live), change **only** the
   website records:
   - apex `lukesgoodlifestyle.com` → **A 75.2.60.5** (Netlify load balancer)
   - `www` → **CNAME lukesgoodlifestyle.netlify.app**

   **Do not move the nameservers to Netlify DNS** and do not touch the MX or
   TXT (SPF) records. Luke's mailbox and the order emails depend on them.
3. HTTPS is automatic (Let's Encrypt) a few minutes after DNS propagates.
4. If the Paystack webhook was registered on the netlify.app URL, update it to
   `https://lukesgoodlifestyle.com/api/paystack/webhook` (Paystack Dashboard →
   Settings → API Keys & Webhooks).

## Local dev
Serve the folder with any static server (e.g. `python -m http.server 8080`).
The admin needs the deployed backend; locally it shows "backend unavailable".
Every push to `main` auto-deploys.

Contact: WhatsApp 073 028 3066 · ripponluke@gmail.com · @lukesgoodlifestyle
