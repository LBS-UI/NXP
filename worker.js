export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/upload-url") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = body.contentType || "";
    if (!contentType.startsWith("image/")) {
      return new Response(JSON.stringify({ error: "contentType must be an image/* type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.CF_ACCOUNT_HASH) {
      return new Response(JSON.stringify({ error: "Worker secrets missing (CF_ACCOUNT_ID, CF_API_TOKEN, or CF_ACCOUNT_HASH)" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/images/v2/direct_upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requireSignedURLs: false,
          metadata: { source: "snapstudio" },
        }),
      }
    );

    const cfJson = await cfRes.json();

    if (!cfRes.ok || !cfJson.success) {
      return new Response(
        JSON.stringify({
          error: "Cloudflare Images API error",
          errors: cfJson.errors || [],
          status: cfRes.status,
        }),
        {
          status: cfRes.status || 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const result = cfJson.result;
    const publicURL = `https://imagedelivery.net/${env.CF_ACCOUNT_HASH}/${result.id}/public`;

    return new Response(
      JSON.stringify({
        uploadURL: result.uploadURL,
        imageId: result.id,
        publicURL,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  },
};
