/**
 * SnapStudio Cloudflare Worker
 * - POST /api/images       Upload a processed image to a private R2 bucket.
 * - GET  /api/images/:id   Download the image as an attachment.
 * - Scheduled handler      Deletes expired images from R2.
 *
 * Required R2 binding: IMAGES
 * Configuration: see wrangler.jsonc
 */

const IMAGE_PREFIX = "images/";
const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_TTL_HOURS = 24;

function getAllowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  return Boolean(origin) && getAllowedOrigins(env).includes(origin);
}

function corsHeaders(request, env) {
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  });

  const origin = request.headers.get("Origin");
  if (origin && isAllowedOrigin(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(request, env, data, status = 200, extraHeaders = {}) {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), { status, headers });
}

function getMaxUploadBytes(env) {
  const configured = Number(env.MAX_UPLOAD_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_UPLOAD_BYTES;
}

function getTtlHours(env) {
  const configured = Number(env.IMAGE_TTL_HOURS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TTL_HOURS;
}

async function readBodyWithLimit(request, maxBytes) {
  const headerLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(headerLength) && headerLength > maxBytes) {
    throw new Response("Upload is too large.", { status: 413 });
  }

  if (!request.body) {
    throw new Response("The upload body is empty.", { status: 400 });
  }

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel("Upload size limit exceeded.");
        throw new Response("Upload is too large.", { status: 413 });
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) {
    throw new Response("The upload body is empty.", { status: 400 });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function identifyImage(bytes) {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }

  // PNG signature
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSignature.every((byte, index) => bytes[index] === byte)) {
    return { contentType: "image/png", extension: "png" };
  }

  // WebP: RIFF....WEBP
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }

  return null;
}

function createImageId(expirationSeconds) {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  const hex = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${expirationSeconds.toString(36)}-${hex}`;
}

function getExpirationFromId(id) {
  const match = /^([0-9a-z]{1,12})-([0-9a-f]{32})$/i.exec(id);
  if (!match) return null;
  const expiration = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(expiration) ? expiration : null;
}

async function handleUpload(request, env) {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin, env)) {
    return jsonResponse(request, env, {
      success: false,
      error: "This website origin is not allowed to upload images."
    }, 403);
  }

  const maxBytes = getMaxUploadBytes(env);
  let bytes;

  try {
    bytes = await readBodyWithLimit(request, maxBytes);
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse(request, env, {
        success: false,
        error: await error.text()
      }, error.status);
    }
    return jsonResponse(request, env, {
      success: false,
      error: "Unable to read the uploaded image."
    }, 400);
  }

  const image = identifyImage(bytes);
  if (!image) {
    return jsonResponse(request, env, {
      success: false,
      error: "Unsupported image. Please upload a JPEG, PNG, or WebP image."
    }, 415);
  }

  const expiresAtSeconds = Math.floor(Date.now() / 1000 + getTtlHours(env) * 3600);
  const id = createImageId(expiresAtSeconds);
  const key = `${IMAGE_PREFIX}${id}`;

  try {
    await env.IMAGES.put(key, bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "private, no-store"
      },
      customMetadata: {
        createdAt: new Date().toISOString(),
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
        extension: image.extension
      }
    });
  } catch (error) {
    return jsonResponse(request, env, {
      success: false,
      error: "Storage is temporarily unavailable. Please try again."
    }, 500);
  }

  const requestUrl = new URL(request.url);
  return jsonResponse(request, env, {
    success: true,
    id,
    downloadUrl: `${requestUrl.origin}/api/images/${id}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
  }, 201);
}

async function handleDownload(request, env, id) {
  const expiresAtSeconds = getExpirationFromId(id);
  if (!expiresAtSeconds) {
    return jsonResponse(request, env, { success: false, error: "Invalid image link." }, 404);
  }

  const key = `${IMAGE_PREFIX}${id}`;
  if (expiresAtSeconds <= Math.floor(Date.now() / 1000)) {
    // Delete lazily as well, in case the scheduled cleanup has not run yet.
    await env.IMAGES.delete(key).catch(() => {});
    return jsonResponse(request, env, {
      success: false,
      error: "This image link has expired. Please create a new QR code."
    }, 404);
  }

  let object;
  try {
    object = await env.IMAGES.get(key);
  } catch (error) {
    return jsonResponse(request, env, {
      success: false,
      error: "Unable to retrieve the image right now."
    }, 500);
  }

  if (!object) {
    return jsonResponse(request, env, {
      success: false,
      error: "Image not found. It may have expired or been deleted."
    }, 404);
  }

  const headers = corsHeaders(request, env);
  object.writeHttpMetadata(headers);
  const extension = object.customMetadata?.extension || "jpg";
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="snapstudio-image.${extension}"`);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Length", String(object.size));

  return new Response(object.body, { status: 200, headers });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request.headers.get("Origin"), env)) {
      return new Response(null, { status: 403, headers });
    }
    return new Response(null, { status: 204, headers });
  }

  if (url.pathname === "/api/images" && request.method === "POST") {
    return handleUpload(request, env);
  }

  const match = /^\/api\/images\/([0-9a-z]{1,12}-[0-9a-f]{32})$/i.exec(url.pathname);
  if (match && request.method === "GET") {
    return handleDownload(request, env, match[1]);
  }

  if (url.pathname === "/api/images" || url.pathname.startsWith("/api/images/")) {
    return jsonResponse(request, env, { success: false, error: "Method not allowed." }, 405, {
      "Allow": "GET, POST, OPTIONS"
    });
  }

  return jsonResponse(request, env, {
    success: false,
    error: "Not found."
  }, 404);
}

async function cleanupExpiredImages(env) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let cursor;
  let deleted = 0;

  do {
    const page = await env.IMAGES.list({
      prefix: IMAGE_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {})
    });

    const expiredKeys = [];
    for (const object of page.objects) {
      const id = object.key.slice(IMAGE_PREFIX.length);
      const expiresAtSeconds = getExpirationFromId(id);
      if (expiresAtSeconds !== null && expiresAtSeconds <= nowSeconds) {
        expiredKeys.push(object.key);
      }
    }

    if (expiredKeys.length > 0) {
      await env.IMAGES.delete(expiredKeys);
      deleted += expiredKeys.length;
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  console.log(`SnapStudio cleanup completed. Deleted ${deleted} expired image(s).`);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanupExpiredImages(env));
  }
};
