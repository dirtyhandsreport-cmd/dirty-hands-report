const FB_TOKEN = "EAAoWza7AAJoBRCGLsuBq3ZCcWMQuvzFteLlxzmhduZAeUZAd3vn8DwjemN6IWRvrZCX0YENBXUpi7Ygr7cRgpnRCHGw6MZBZANnjIpAgjEvcycjxlVMRmXcvnUhJxkXLdnC8ZBSCbzYb6BxiL1AJ5iNfmnlHlv1aBAOZA3TVS0ZBZCcxQqMKmGbfvtjuB9NUfNkcDeRbpWMHYOEPE31Fp9zsJFKIbMZBCDS4962G7Urn8Oevx3GqxFetf0ZD";
const FB_PAGE_ID = "895200170345079";
const FB_BASE = "https://graph.facebook.com/v19.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response("", { status: 200, headers: CORS });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
    }

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

    const { action, message, nextUrl } = body;

    try {
      if (action === "sync") {
        const [pageRes, postsRes] = await Promise.all([
          fetch(`${FB_BASE}/${FB_PAGE_ID}?fields=followers_count,fan_count,name&access_token=${FB_TOKEN}`),
          fetch(`${FB_BASE}/${FB_PAGE_ID}/posts?fields=message,created_time,likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_reach)&limit=100&access_token=${FB_TOKEN}`),
        ]);

        const page = await pageRes.json();
        const postsData = await postsRes.json();

        if (page.error) return new Response(JSON.stringify({ error: page.error.message }), { status: 400, headers: CORS });
        if (postsData.error) return new Response(JSON.stringify({ error: postsData.error.message }), { status: 400, headers: CORS });

        let allRaw = postsData.data || [];
        if (postsData.paging?.next && allRaw.length >= 100) {
          try {
            const res2 = await fetch(postsData.paging.next);
            const d2 = await res2.json();
            allRaw = [...allRaw, ...(d2.data || [])];
          } catch (_) {}
        }

        return new Response(JSON.stringify({ page, insight: { data: [] }, posts: allRaw }), { status: 200, headers: CORS });
      }

      if (action === "paginate" && nextUrl) {
        const res = await fetch(nextUrl);
        const data = await res.json();
        return new Response(JSON.stringify(data), { status: 200, headers: CORS });
      }

      if (action === "post" && message) {
        const res = await fetch(`${FB_BASE}/${FB_PAGE_ID}/feed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, access_token: FB_TOKEN }),
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), { status: 200, headers: CORS });
      }

      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: CORS });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Server error" }), { status: 500, headers: CORS });
    }
  }
};
