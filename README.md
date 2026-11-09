# SnapStudio — Cloudflare QR Image Downloader

This starter project contains:

- `index.html` — camera capture, image upload, center crop (16:9, 4:3, 1:1), JPG/PNG/WebP export, QR generation, and QR download.
- `worker.js` — upload API, download route, and scheduled expiry cleanup.
- `wrangler.jsonc` — Cloudflare Worker configuration and private R2 binding.

## 1. Create the R2 bucket

From a terminal with Node.js installed:

```bash
npx wrangler login
npx wrangler r2 bucket create snapstudio-images
```

The bucket stays private. Do not enable public bucket access; the Worker serves the download route.

## 2. Configure the frontend origin

Edit `wrangler.jsonc` and replace `https://YOUR_USERNAME.github.io` with the exact origin of your GitHub Pages website.

Examples:

- Project Pages: `https://YOUR_USERNAME.github.io` (the repository path is not included in the origin).
- Custom domain: `https://photos.example.com`.

Keep the localhost entries if you will test locally. Add any other exact origins you use, separated by commas.

## 3. Deploy the Worker

From this project folder:

```bash
npx wrangler deploy
```

Wrangler will show the deployed Worker URL. It will usually look like:

```text
https://snapstudio-api.YOUR_SUBDOMAIN.workers.dev
```

The `triggers.crons` entry schedules cleanup hourly. Confirm that the Cron Trigger is visible in the Worker settings after deployment.

## 4. Connect the website

Open `index.html` and replace:

```js
const API_BASE_URL = "https://snapstudio-api.YOUR_SUBDOMAIN.workers.dev";
```

with the exact Worker URL printed by Wrangler. Do not add `/api/images` to the base URL; the page appends that route itself.

Upload `index.html` to your GitHub Pages repository, or deploy it with Cloudflare Pages.

## 5. Test the complete flow

1. Open the website over HTTPS (or localhost during development).
2. Allow camera access or choose an image file.
3. Select an aspect ratio and image format.
4. Click **Upload Image & Generate QR**.
5. Wait for the success message and QR code.
6. Scan the QR code using a different phone.
7. The Worker should return the file as an attachment/download.

## Settings

In `wrangler.jsonc`:

- `MAX_UPLOAD_BYTES`: maximum upload size; default is 8 MiB (`8388608`).
- `IMAGE_TTL_HOURS`: link lifetime; default is 24 hours.
- `ALLOWED_ORIGINS`: comma-separated exact website origins.

The Worker checks expiry at download time and the hourly scheduled handler removes expired R2 objects. Scheduled cleanup only runs after the Worker is deployed with its Cron Trigger.

## Security and cost notes

- Never put R2 access keys or Cloudflare API tokens in `index.html`.
- The R2 bucket should remain private.
- CORS origin checks control which browser origins can call the upload API, but Origin headers are not authentication and can be forged by non-browser clients.
- Before making the site widely public, add a Cloudflare WAF rate-limiting rule for `POST /api/images` and consider Turnstile or another abuse-control mechanism. Review R2 usage and set billing/usage alerts.
- The QR link is a bearer link: anyone who has it can download the image until it expires. Do not upload sensitive images.

## Notes

- The QR-code library is loaded from cdnjs, so QR generation needs an internet connection.
- Camera access requires HTTPS or localhost.
- This starter code does not include user accounts or private per-user image permissions.
