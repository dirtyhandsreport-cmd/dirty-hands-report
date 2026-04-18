const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, anthropic-version, anthropic-beta",
};

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  var body = {};
  try { body = await request.json(); } catch (_) {}

  var action = body.action;

  if (action === "anthropic") {
    var apiKey = body.apiKey;
    var payload = body.payload;
    var aHeaders = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    if (payload.tools && payload.tools.some(function(t){ return t.type === "web_search_20250305"; })) {
      aHeaders["anthropic-beta"] = "web-search-2025-03-05";
    }
    var aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: aHeaders,
      body: JSON.stringify(payload),
    });
    var aData = await aRes.json();
    return new Response(JSON.stringify(aData), {
      status: aRes.status,
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  if (action === "eia") {
    var eiaKey = body.eiaKey;
    if (!eiaKey) {
      return new Response(JSON.stringify({ error: "Missing EIA API key" }), {
        status: 400, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }
    var base = "https://api.eia.gov/v2";

    // Fetch all three in parallel
    var results = await Promise.allSettled([
      // WTI daily spot price — last 3 days
      fetch(base + "/petroleum/pri/spt/data/?api_key=" + eiaKey + "&frequency=daily&data[0]=value&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&length=3"),
      // US crude oil stocks weekly — last 3 weeks
      fetch(base + "/petroleum/stoc/wstk/data/?api_key=" + eiaKey + "&frequency=weekly&data[0]=value&facets[series][]=WCRSTUS1&sort[0][column]=period&sort[0][direction]=desc&length=3"),
      // US drilling rig count weekly — last 3 weeks
      fetch(base + "/drilling/rigs/data/?api_key=" + eiaKey + "&frequency=weekly&data[0]=value&facets[duoarea][]=NUS&sort[0][column]=period&sort[0][direction]=desc&length=3"),
    ]);

    var out = {};

    // WTI
    try {
      if (results[0].status === "fulfilled") {
        var wtiData = await results[0].value.json();
        var wtiRows = wtiData && wtiData.response && wtiData.response.data;
        if (wtiRows && wtiRows.length >= 2) {
          var latest = parseFloat(wtiRows[0].value);
          var prev = parseFloat(wtiRows[1].value);
          out.wti = { price: latest.toFixed(2), change: (latest - prev).toFixed(2), date: wtiRows[0].period };
        } else if (wtiRows && wtiRows.length === 1) {
          out.wti = { price: parseFloat(wtiRows[0].value).toFixed(2), change: "0.00", date: wtiRows[0].period };
        }
      }
    } catch(e) {}

    // Crude inventory
    try {
      if (results[1].status === "fulfilled") {
        var invData = await results[1].value.json();
        var invRows = invData && invData.response && invData.response.data;
        if (invRows && invRows.length >= 2) {
          var invLatest = parseFloat(invRows[0].value);
          var invPrev = parseFloat(invRows[1].value);
          // EIA reports in thousands of barrels — convert to millions
          out.inventory = { value: (invLatest / 1000).toFixed(1), change: ((invLatest - invPrev) / 1000).toFixed(1), date: invRows[0].period };
        }
      }
    } catch(e) {}

    // Rig count
    try {
      if (results[2].status === "fulfilled") {
        var rigData = await results[2].value.json();
        var rigRows = rigData && rigData.response && rigData.response.data;
        if (rigRows && rigRows.length >= 2) {
          var rigLatest = parseInt(rigRows[0].value);
          var rigPrev = parseInt(rigRows[1].value);
          out.rigs = { count: rigLatest, change: rigLatest - rigPrev, date: rigRows[0].period };
        }
      }
    } catch(e) {}

    if (!out.wti && !out.inventory && !out.rigs) {
      return new Response(JSON.stringify({ error: "EIA returned no data — check API key" }), {
        status: 400, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }

    return new Response(JSON.stringify(out), {
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  if (action === "reddit") {
    var subs = ["oilfield", "oilandgasworkers", "energy"];
    var sorts = ["hot", "rising"];
    var seen = {};
    var posts = [];

    for (var s = 0; s < subs.length; s++) {
      for (var r = 0; r < sorts.length; r++) {
        try {
          var rdRes = await fetch(
            "https://www.reddit.com/r/" + subs[s] + "/" + sorts[r] + ".json?limit=20&raw_json=1",
            { headers: { "User-Agent": "DHR-Radar/1.0 by DirtyHandsReport" } }
          );
          var rdData = await rdRes.json();
          if (!rdData.data || !rdData.data.children) continue;
          for (var c = 0; c < rdData.data.children.length; c++) {
            var p = rdData.data.children[c].data;
            if (seen[p.id] || p.stickied) continue;
            seen[p.id] = true;

            // DHR relevance scoring
            var text = (p.title + " " + (p.selftext || "")).toLowerCase();
            var dhrScore = 1;
            if (/fatal|death|died|killed|injur|explosion|blowout|spill|fire|accident|layoff|laid off|shutdown|shut down/.test(text)) {
              dhrScore = 3;
            } else if (/bakken|williston|north dakota|permian|wti|brent|crude|rig count|frac|wireline|hormuz|opec|iran|sanction|pipeline|dapl|keystone|oilfield|oil field|oil patch/.test(text)) {
              dhrScore = 2;
            }

            posts.push({
              id: p.id,
              title: p.title,
              subreddit: p.subreddit,
              sort: sorts[r],
              upvotes: p.score,
              comments: p.num_comments,
              url: "https://reddit.com" + p.permalink,
              snippet: (p.selftext || "").slice(0, 300),
              created: p.created_utc,
              dhrScore: dhrScore
            });
          }
        } catch(e) {
          // skip failed subreddit/sort combo
        }
      }
    }

    // Sort by dhrScore desc, then upvotes desc
    posts.sort(function(a, b) {
      return b.dhrScore - a.dhrScore || b.upvotes - a.upvotes;
    });

    return new Response(JSON.stringify({ posts: posts.slice(0, 25) }), {
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  if (action === "sync") {
    var token = body.token;
    var pageId = body.pageId;
    if (!token || !pageId) {
      return new Response(JSON.stringify({ error: "Missing token or pageId" }), {
        status: 400,
        headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }

    var base = "https://graph.facebook.com/v21.0";

    var pageRes = await fetch(base + "/" + pageId + "?fields=name,fan_count,followers_count&access_token=" + token);
    var pageData = await pageRes.json();
    if (pageData.error) {
      return new Response(JSON.stringify({ error: "PAGE: " + pageData.error.message + " (code " + pageData.error.code + ")" }), {
        status: 400,
        headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }

    var postsUrl = base + "/" + pageId + "/posts?fields=message,created_time&limit=10&access_token=" + token;
    var p1Res = await fetch(postsUrl);
    var p1Data = await p1Res.json();

    if (p1Data.error) {
      return new Response(JSON.stringify({ error: "POSTS: " + p1Data.error.message + " (code " + p1Data.error.code + ")" }), {
        status: 400,
        headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }

    if (!p1Data.data || p1Data.data.length === 0) {
      return new Response(JSON.stringify({ error: "FB RETURNED 0 POSTS — keys: " + Object.keys(p1Data).join(",") + " — paging: " + JSON.stringify(p1Data.paging||"none") }), {
        status: 400,
        headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }

    var allPosts = p1Data.data.slice();
    var nextUrl = p1Data.paging && p1Data.paging.next;
    for (var i = 0; i < 3 && nextUrl && allPosts.length < 400; i++) {
      var pRes = await fetch(nextUrl);
      var pData = await pRes.json();
      if (pData.data) allPosts = allPosts.concat(pData.data);
      nextUrl = pData.paging && pData.paging.next;
    }

    var filteredPosts = allPosts.filter(function(p){ return p.message; });

    return new Response(JSON.stringify({ page: pageData, posts: filteredPosts }), {
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  if (action === "post") {
    var tok = body.token;
    var pid = body.pageId;
    var msg = body.message;
    var fRes = await fetch("https://graph.facebook.com/v21.0/" + pid + "/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, access_token: tok }),
    });
    var fData = await fRes.json();
    return new Response(JSON.stringify(fData), {
      status: fRes.status,
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
  });
}
