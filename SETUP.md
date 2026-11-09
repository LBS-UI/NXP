# SnapStudio + Cloudflare Images Direct Creator Upload — Setup Guide

This guide assumes you already have a GitHub Pages repository containing the updated `index.html`. You do **not** need any build tools.

## 1. Create a Cloudflare account
Go to https://dash.cloudflare.com/sign-up and create a free account. The free plan is sufficient for setup and low-volume testing.

## 2. Enable Cloudflare Images and note the Account Hash
1. In the Cloudflare dashboard open **Images**.
2. Enable the product if prompted.
3. Look for the **Delivery URL** section. It will look like:
   `https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT>`
4. Copy the `<ACCOUNT_HASH>` value. You will need it as the `CF_ACCOUNT_HASH` secret.

## 3. Note your Account ID
- Open the Cloudflare dashboard.
- The Account ID is the 32-character hex string in the URL:  
  `https://dash.cloudflare.com/<ACCOUNT_ID>/...`
- Or go to **Workers & Pages → Overview** and copy the Account ID shown there.

## 4. Create an API Token
1. Click your profile icon → **My Profile → API Tokens**.
2. Click **Create Token**.
3. Choose **Create Custom Token**.
4. Permissions:
   - **Account** → **Cloudflare Images** → **Edit**
5. Account Resources: include your account.
6. Create the token and **copy it immediately**. You will not see it again. This becomes the `CF_API_TOKEN` secret.

## 5. Deploy the Worker
1. In the Cloudflare dashboard go to **Workers & Pages → Create → Worker**.
2. Give it a name (e.g. `snapstudio-upload`).
3. Replace the default code with the contents of `worker.js` and save/deploy.
4. Open the Worker → **Settings → Variables**.
5. Under **Environment Variables** (or Secrets) add three **encrypted secrets** (not plain-text variables):
   - `CF_ACCOUNT_ID` = your Account ID
   - `CF_API_TOKEN` = the API token you just created
   - `CF_ACCOUNT_HASH` = the account hash from step 2
6. Deploy again if prompted.
7. Copy the Worker URL shown (example: `https://snapstudio-upload.yourname.workers.dev`).

## 6. Configure the HTML
Open `index.html` and replace the placeholder:
```js
const CF_WORKER_URL = "YOUR_WORKER_URL_HERE";
```
with your real Worker URL (no trailing slash).

## 7. Commit and push to GitHub Pages
Commit the updated `index.html` and push. Wait for GitHub Pages to finish deploying.

## 8. Test the app
1. Open the GitHub Pages URL in a browser (HTTPS is required for camera access on most devices).
2. Allow camera permission or upload an image.
3. Adjust ratio / format / quality if desired.
4. Click **Upload Image & Generate QR**.
5. A QR code should appear. Scan it with a second phone; the image should open in the browser from `imagedelivery.net`.

## 9. Verify the Worker with curl
```bash
curl -X POST https://YOUR_WORKER_URL/api/upload-url \
  -H "Content-Type: application/json" \
  -d '{"contentType":"image/jpeg"}'
```
You should receive JSON containing `uploadURL`, `imageId`, and `publicURL`.

---

## Pricing note
Cloudflare Images is a paid feature. Storage is roughly $5 per 100,000 images stored per month; delivery is metered separately. Always check the current pricing page on Cloudflare’s website before committing real traffic.

## Important notes
- Direct Creator Upload URLs are **one-time and short-lived**. The browser must POST the image immediately after receiving the URL. The `generateQR()` function never caches an upload URL; every click requests a fresh one.
- Cloudflare Images serves files with `Content-Disposition: inline` by default. The QR code therefore opens a browser-viewable image. Users save it with a long-press (mobile) or right-click → Save Image (desktop).  
  If you later need forced downloads you can extend the Worker into a simple proxy that adds `Content-Disposition: attachment`, but that is out of scope here.
- The Cloudflare API token never appears in the frontend HTML or JavaScript; it exists only as a Worker secret.

## Troubleshooting
| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| 403 from Worker | `CF_API_TOKEN` missing Images:Edit permission or not set | Recreate the token with the correct permission and re-add the secret |
| CORS preflight failure / browser blocks OPTIONS | Worker not returning Access-Control-Allow-* headers on OPTIONS | Confirm the Worker code returns the CORS headers for OPTIONS |
| 415 / 400 from Cloudflare on the upload step | FormData field is not named `file`, or MIME type is not `image/*` | Check the FormData append and the blob’s type |
| QR appears but scanning shows a Cloudflare error page | Wrong `CF_ACCOUNT_HASH` | Re-copy the hash from the Images dashboard Delivery URL |
| Image uploaded but public URL returns 404 | The `public` variant is not enabled | In Images dashboard ensure the default `public` variant exists and is enabled |
| “Requesting upload URL failed” and Retry button appears | Worker unreachable or secrets missing | Check Worker logs and that all three secrets are set |

Once the three secrets and `CF_WORKER_URL` are filled in, the system is ready.
