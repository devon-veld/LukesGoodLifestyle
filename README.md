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
  checkout.mjs        /api/checkout  server-priced order -> Yoco hosted checkout (or manual fallback)
  yoco-webhook.mjs    /api/yoco/webhook  payment.succeeded -> mark paid, stock, emails
  lib/util.mjs        blobs (strong consistency), scrypt, sessions, rate-limit, Brevo, pricing
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
| `YOCO_SECRET_KEY` | Enables real card payments (`sk_live_…`) | Yoco portal → Selling online → API keys |
| `YOCO_WEBHOOK_SECRET` | Verifies payment webhooks (`whsec_…`) | Yoco portal → register webhook `https://lukesgoodlifestyle.com/api/yoco/webhook` |
| `BREVO_API_KEY` | Transactional emails (`xkeysib-…`) | Brevo → SMTP & API → API keys |
| `BREVO_SENDER_EMAIL` | The "from" address (default `ripponluke@gmail.com`) | must be a **verified sender** in Brevo |
| `ORDER_NOTIFY_EMAIL` | Where Luke's "new order" mails go (default `ripponluke@gmail.com`) | — |
| `ADMIN_SETUP_CODE` | optional: extra code required for first-run password setup | choose any value |
| `AUTH_SECRET` | optional: fixed session-signing secret (else auto-generated) | any long random string |

After adding variables: **Deploys → Trigger deploy** so functions pick them up.

### Payment behaviour
- **With `YOCO_SECRET_KEY`:** checkout → Yoco hosted payment page → webhook marks
  the order *Pending (paid)*, decrements stock, emails the customer a confirmation
  and Luke a "new PAID order" alert. Success returns to the site with a
  confirmation modal.
- **Without it (current):** orders are recorded as manual/unpaid, stock is
  reserved, both emails still send (once Brevo is configured), and Luke arranges
  payment on WhatsApp. The site is fully usable pre-Yoco.

### Emails sent via Brevo
1. Order received / payment confirmed → customer
2. New order alert → Luke (`ORDER_NOTIFY_EMAIL`)
3. Order shipped → customer (when Luke clicks *Mark shipped*)

## Performance
- Media: 45MB → ~6MB total. Initial page transfer ≈ 1MB; videos lazy-load with
  posters (`preload="none"` + IntersectionObserver) and only play on screen.
- Result photos smart-cropped (face detection) to the exact 3:4 display ratio.
- Preloaded hero image, preconnected fonts, deferred GTM.

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
2. At the domain registrar, either move nameservers to Netlify DNS
   (simplest), or set records manually:
   - apex `lukesgoodlifestyle.com` → **A 75.2.60.5** (Netlify load balancer)
   - `www` → **CNAME lukesgoodlifestyle.netlify.app**
3. HTTPS is automatic (Let's Encrypt) a few minutes after DNS propagates.
4. If the Yoco webhook was registered on the netlify.app URL, update it to
   `https://lukesgoodlifestyle.com/api/yoco/webhook`.

## Local dev
Serve the folder with any static server (e.g. `python -m http.server 8080`).
The admin needs the deployed backend; locally it shows "backend unavailable".
Every push to `main` auto-deploys.

Contact: WhatsApp 073 028 3066 · ripponluke@gmail.com · @lukesgoodlifestyle
