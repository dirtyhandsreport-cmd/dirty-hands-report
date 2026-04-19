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
    var apiKey = body.apiKey || body.key;
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

  if (action === "eia") {
    var eiaKey = body.eiaKey;
    if (!eiaKey) {
      return new Response(JSON.stringify({ error: "Missing EIA API key" }), {
        status: 400, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }
    var base = "https://api.eia.gov/v2";

    var results = await Promise.allSettled([
      // WTI daily spot price
      fetch(base + "/petroleum/pri/spt/data/?api_key=" + eiaKey + "&frequency=daily&data[0]=value&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&length=3"),
      // US crude oil stocks weekly
      fetch(base + "/petroleum/stoc/wstk/data/?api_key=" + eiaKey + "&frequency=weekly&data[0]=value&facets[series][]=WCRSTUS1&sort[0][column]=period&sort[0][direction]=desc&length=3"),
      // US retail diesel price weekly
      fetch(base + "/petroleum/pri/gnd/data/?api_key=" + eiaKey + "&frequency=weekly&data[0]=value&facets[series][]=EMD_EPD2D_PTE_NUS_DPG&sort[0][column]=period&sort[0][direction]=desc&length=3"),
      // Henry Hub natural gas daily spot
      fetch(base + "/natural-gas/pri/spot/data/?api_key=" + eiaKey + "&frequency=daily&data[0]=value&facets[series][]=RNGWHHD&sort[0][column]=period&sort[0][direction]=desc&length=3"),
      // US drilling rig count weekly
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
          out.inventory = { value: (invLatest / 1000).toFixed(1), change: ((invLatest - invPrev) / 1000).toFixed(1), date: invRows[0].period };
        }
      }
    } catch(e) {}

    // Diesel price
    try {
      if (results[2].status === "fulfilled") {
        var dieselData = await results[2].value.json();
        var dieselRows = dieselData && dieselData.response && dieselData.response.data;
        if (dieselRows && dieselRows.length >= 2) {
          var dLatest = parseFloat(dieselRows[0].value);
          var dPrev = parseFloat(dieselRows[1].value);
          out.diesel = { price: dLatest.toFixed(3), change: (dLatest - dPrev).toFixed(3), date: dieselRows[0].period };
        } else if (dieselRows && dieselRows.length === 1) {
          out.diesel = { price: parseFloat(dieselRows[0].value).toFixed(3), change: "0.000", date: dieselRows[0].period };
        }
      }
    } catch(e) {}

    // Henry Hub natural gas
    try {
      if (results[3].status === "fulfilled") {
        var ngData = await results[3].value.json();
        var ngRows = ngData && ngData.response && ngData.response.data;
        if (ngRows && ngRows.length >= 2) {
          var ngLatest = parseFloat(ngRows[0].value);
          var ngPrev = parseFloat(ngRows[1].value);
          out.natgas = { price: ngLatest.toFixed(2), change: (ngLatest - ngPrev).toFixed(2), date: ngRows[0].period };
        } else if (ngRows && ngRows.length === 1) {
          out.natgas = { price: parseFloat(ngRows[0].value).toFixed(2), change: "0.00", date: ngRows[0].period };
        }
      }
    } catch(e) {}

    // Rig count via EIA
    try {
      if (results[4].status === "fulfilled") {
        var rigData = await results[4].value.json();
        var rigRows = rigData && rigData.response && rigData.response.data;
        if (rigRows && rigRows.length >= 2) {
          var rigLatest = parseInt(rigRows[0].value);
          var rigPrev = parseInt(rigRows[1].value);
          out.rigs = { count: rigLatest, change: rigLatest - rigPrev, date: rigRows[0].period };
        }
      }
    } catch(e) {}

    if (!out.wti && !out.inventory) {
      return new Response(JSON.stringify({ error: "EIA returned no data — check API key" }), {
        status: 400, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }

    return new Response(JSON.stringify(out), {
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  // WIRE tab — fetch_rss
  if (action === "fetch_rss") {
    // Fetch from raw GitHub — bypasses GitHub Pages CDN cache entirely
    try {
      var opsRes = await fetch("https://raw.githubusercontent.com/dirtyhandsreport-cmd/dhr.ops/main/public/feed.json?t=" + Date.now(), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DHRBot/1.0)", "Cache-Control": "no-cache" },
        cf: { cacheTtl: -1 }
      });
      if (opsRes.ok) {
        var opsData = await opsRes.json();
        if (opsData && opsData.items && opsData.items.length > 0) {
          // Sort by date desc, cap at 100 items for performance
          var opsItems = opsData.items.sort(function(a,b){ return new Date(b.date) - new Date(a.date); }).slice(0, 100);
          return new Response(JSON.stringify({ ok: true, items: opsItems }), {
            headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
          });
        }
      }
    } catch(opsErr) {}

    // Fallback — fetch direct from 8 key RSS sources
    var wireFeeds = [
      { url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", source: "Rigzone" },
      { url: "https://oilprice.com/rss/main", source: "OilPrice" },
      { url: "https://www.eia.gov/rss/todayinenergy.xml", source: "EIA" },
      { url: "https://feeds.reuters.com/reuters/businessNews", source: "Reuters" },
      { url: "https://www.hartenergy.com/rss/oil-gas-news", source: "Hart Energy" },
      { url: "https://bismarcktribune.com/search/?f=rss&t=article&c=news/state-and-regional/energy&l=50", source: "Bismarck Tribune" },
      { url: "https://www.willistonherald.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc", source: "Williston Herald" },
      { url: "https://kfyrtv.com/feed/", source: "KFYR" },
    ];
    var wireItems = [];
    var wireSeen = {};
    for (var wf = 0; wf < wireFeeds.length; wf++) {
      try {
        var wfRes = await fetch(wireFeeds[wf].url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; DHRBot/1.0)", "Accept": "application/rss+xml, text/xml, */*" }
        });
        var wfText = await wfRes.text();
        var wfItems = wfText.match(/<item[\s\S]*?<\/item>/gi) || [];
        for (var wi = 0; wi < Math.min(wfItems.length, 15); wi++) {
          var wItem = wfItems[wi];
          var wTitle = (wItem.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || wItem.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
          var wLink = (wItem.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1];
          var wDate = (wItem.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
          var wDesc = (wItem.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || wItem.match(/<description[^>]*>([\s\S]*?)<\/description>/) || [])[1];
          if (!wTitle) continue;
          var cleanTitle = wTitle.replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
          var cleanLink = wLink ? wLink.replace(/<[^>]+>/g,"").trim() : "#";
          var cleanDesc = wDesc ? wDesc.replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s{2,}/g," ").trim().slice(0,300) : "";
          var cleanDate = wDate ? wDate.trim() : new Date().toUTCString();
          if (wireSeen[cleanTitle]) continue;
          wireSeen[cleanTitle] = true;
          wireItems.push({ title: cleanTitle, source: wireFeeds[wf].source, date: cleanDate, summary: cleanDesc, url: cleanLink });
        }
      } catch(e) {}
    }
    return new Response(JSON.stringify({ ok: true, items: wireItems }), {
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  // Baker Hughes rig count scraper
  if (action === "rig_count") {
    try {
      var bhRes = await fetch("https://rigcount.bakerhughes.com/na-rig-count", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DHRBot/1.0)", "Accept": "text/html" }
      });
      var bhHtml = await bhRes.text();
      // Try to find US total count in page — BH uses various formats
      var usMatch = bhHtml.match(/United States[\s\S]{0,200}?(\d{3,4})/i) ||
                    bhHtml.match(/U\.S\.[\s\S]{0,100}?(\d{3,4})/i) ||
                    bhHtml.match(/>(\d{3,4})<\/td>/);
      if (usMatch) {
        return new Response(JSON.stringify({ count: parseInt(usMatch[1]), source: "Baker Hughes", date: new Date().toLocaleDateString() }), {
          headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
        });
      }
      return new Response(JSON.stringify({ error: "Could not parse rig count" }), {
        status: 400, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: "Rig count fetch failed: " + e.message }), {
        status: 500, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }
  }

  // RSS news feed — Rigzone + OilPrice
  if (action === "news_feed") {
    var feeds = [
      { url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", source: "Rigzone" },
      { url: "https://oilprice.com/rss/main", source: "OilPrice" },
      { url: "https://www.eia.gov/rss/todayinenergy.xml", source: "EIA" },
    ];
    var allItems = [];
    for (var f = 0; f < feeds.length; f++) {
      try {
        var rssRes = await fetch(feeds[f].url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DHRBot/1.0)" } });
        var rssText = await rssRes.text();
        // Parse RSS items
        var itemMatches = rssText.match(/<item[\s\S]*?<\/item>/gi) || [];
        for (var i = 0; i < Math.min(itemMatches.length, 10); i++) {
          var item = itemMatches[i];
          var titleMatch = item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title[^>]*>([\s\S]*?)<\/title>/);
          var linkMatch = item.match(/<link[^>]*>([\s\S]*?)<\/link>/) || item.match(/<link>([\s\S]*?)<\/link>/);
          var dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
          var descMatch = item.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || item.match(/<description[^>]*>([\s\S]*?)<\/description>/);
          if (!titleMatch) continue;
          var title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
          var link = linkMatch ? linkMatch[1].replace(/<[^>]+>/g, "").trim() : "#";
          var date = dateMatch ? dateMatch[1].trim() : "";
          var desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").trim().slice(0, 200) : "";
          // Score for DHR relevance
          var text = (title + " " + desc).toLowerCase();
          var score = 1;
          if (/fatal|death|killed|injur|explosion|blowout|spill|fire|accident|layoff|shutdown/.test(text)) score = 3;
          else if (/bakken|williston|north dakota|permian|wti|brent|crude|rig count|frac|wireline|hormuz|opec|iran|pipeline|dapl/.test(text)) score = 2;
          allItems.push({ title, link, date, desc, source: feeds[f].source, score });
        }
      } catch(e) {}
    }
    allItems.sort(function(a, b) { return b.score - a.score; });
    return new Response(JSON.stringify({ items: allItems.slice(0, 20) }), {
      headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
    });
  }

  // NDIC North Dakota permit activity
  if (action === "ndic") {
    try {
      var ndicRes = await fetch("https://www.dmr.nd.gov/oilgas/bkkpermits.asp", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DHRBot/1.0)" }
      });
      var ndicHtml = await ndicRes.text();
      // Count permit rows in the table
      var rows = (ndicHtml.match(/<tr[^>]*>/gi) || []).length;
      // Extract permit numbers if possible
      var permitMatches = ndicHtml.match(/Permit\s*#?\s*(\d+)/gi) || [];
      return new Response(JSON.stringify({
        permitCount: Math.max(0, rows - 2), // subtract header rows
        rawCount: permitMatches.length,
        date: new Date().toLocaleDateString(),
        source: "NDIC"
      }), {
        headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: "NDIC fetch failed: " + e.message }), {
        status: 500, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }
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

  if (action === "hiring_intel") {
    var hiKey = body.apiKey;
    if (!hiKey) {
      return new Response(JSON.stringify({ error: "Missing API key" }), {
        status: 400, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }
    var hiPayload = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: "You are a hiring intelligence analyst for an oilfield media brand. Search job boards and company career pages to find which oilfield companies are actively hiring right now. Return only valid JSON array, no markdown.",
      messages: [{
        role: "user",
        content: "Search Indeed, LinkedIn, Rigzone, and company career portals RIGHT NOW for job postings at these oilfield companies in the Bakken and US oilfields: Chord Energy, Continental Resources, ConocoPhillips, Hess Corporation, Petro-Hunt, Halliburton, SLB, Baker Hughes, Patterson-UTI, Helmerich & Payne, ProPetro, Liberty Oilfield Services, NexTier, Basic Energy Services, Key Energy Services, Archrock, C&J Energy, Calfrac, Go Wireline, Nabors Industries, Newpark Resources, KLX Energy, STEP Energy.\n\nFor each company find how many jobs they currently have posted. Return ONLY a JSON array sorted by posting count descending:\n[\n  {\n    \"company\": \"Company Name\",\n    \"postings\": 12,\n    \"roles\": \"Field Operators, CDL Drivers, Frac Hands\",\n    \"locations\": \"Williston ND, Midland TX\",\n    \"heat\": 3,\n    \"trend\": \"surging\",\n    \"portal\": \"https://careers.company.com\"\n  }\n]\nheat: 3=10+ jobs (hot), 2=4-9 jobs (warm), 1=1-3 jobs (cool), 0=none found\ntrend: surging/steady/slowing/none\nReturn at least 15 companies. JSON only."
      }]
    };
    var hiHeaders = {
      "Content-Type": "application/json",
      "x-api-key": hiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
    };
    var hiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: hiHeaders, body: JSON.stringify(hiPayload),
    });
    var hiData = await hiRes.json();
    var hiText = (hiData.content || []).filter(function(b){ return b.type === "text"; }).map(function(b){ return b.text; }).join("");
    // Extract JSON array from response robustly
    var jsonMatch = hiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) hiText = jsonMatch[0];
    else hiText = hiText.replace(/```json|```/g, "").trim();
    try {
      var parsed = JSON.parse(hiText);
      return new Response(JSON.stringify({ ok: true, companies: parsed, updatedAt: new Date().toISOString() }), {
        headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: "Parse failed", raw: hiText.slice(0, 300) }), {
        status: 400, headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
      });
    }
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: Object.assign({}, CORS, { "Content-Type": "application/json" }),
  });
}
