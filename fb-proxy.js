// DHR Facebook Proxy — Netlify Serverless Function
// Proxies Graph API calls server-side to avoid CORS restrictions in the browser

const FB_TOKEN = "EAAoWza7AAJoBRBoeV4RVvMERbJlWWWbZCLrYM6xFaeUE9y5hjhdjtcydCOKwhDZC6FHZCjvUPc7QEDaPSpEx5wYf3pimsjHQNRb4TfN7qw2tTMvvQiZAZBYZAOxMNZAWQ5XfEuNAWsfM0akX4rQ08uYpRBuFP1XIfxdcCEbKhbeeFFFtYs0MXz3vVtoADZCps6qAk8ZAnZBgZDZD";
const FB_PAGE_ID = "895200170345079";
const FB_BASE = "https://graph.facebook.com/v19.0";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { action, message, nextUrl } = body;

  try {
    // ── SYNC: pull page info + insights + posts ──────────────────────────────
    if (action === "sync") {
      const [pageRes, postsRes] = await Promise.all([
        fetch(`${FB_BASE}/${FB_PAGE_ID}?fields=followers_count,fan_count,name&access_token=${FB_TOKEN}`),
        fetch(`${FB_BASE}/${FB_PAGE_ID}/posts?fields=message,created_time,likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_reach)&limit=100&access_token=${FB_TOKEN}`),
      ]);

      const page = await pageRes.json();
      const insight = { data: [] };
      const postsData = await postsRes.json();

      if (page.error) return { statusCode: 400, headers, body: JSON.stringify({ error: page.error.message }) };
      if (postsData.error) return { statusCode: 400, headers, body: JSON.stringify({ error: postsData.error.message }) };

      // Fetch page 2 if needed
      let allRaw = postsData.data || [];
      if (postsData.paging?.next && allRaw.length >= 100) {
        try {
          const res2 = await fetch(postsData.paging.next);
          const d2 = await res2.json();
          allRaw = [...allRaw, ...(d2.data || [])];
        } catch (_) {}
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ page, insight, posts: allRaw }),
      };
    }

    // ── PAGINATE: fetch next page of posts ───────────────────────────────────
    if (action === "paginate" && nextUrl) {
      const res = await fetch(nextUrl);
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // ── POST: publish to FB page feed ────────────────────────────────────────
    if (action === "post" && message) {
      const res = await fetch(`${FB_BASE}/${FB_PAGE_ID}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, access_token: FB_TOKEN }),
      });
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Server error" }) };
  }
};
