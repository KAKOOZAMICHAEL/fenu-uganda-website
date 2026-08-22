(function ($) {
  "use strict";

  const socket = io();
  const currentPage = (
    window.location.pathname.split("/").pop() || "index.html"
  ).toLowerCase();

  $(document).ready(function () {
    loadSiteData();
    loadCmsSections();
    loadCmsCollections();
    fetchArticles();
    fetchDonations();
    fetchReports();

    socket.on("siteDataUpdated", (payload) => {
      if (!payload || !payload.key) return;
      if (payload.key === "settings") applySettings(payload.value);
    });

    // Reports (PDF list on reports.html) — re-fetch whenever the admin adds,
    // edits, or deletes a report so every open tab stays in sync live.
    socket.on("reportCreated", fetchReports);
    socket.on("reportUpdated", fetchReports);
    socket.on("reportDeleted", fetchReports);

    // When admin saves from dashboard, reload only cms sections (text/image fields)
    socket.on("cms-update", (data) => {
      loadCmsSections();
    });

    socket.on("cmsSectionCreated", handleCmsSectionChange);
    socket.on("cmsSectionUpdated", handleCmsSectionChange);
    socket.on("cmsSectionDeleted", () => loadCmsSections());
    socket.on("cmsCollectionItemCreated", loadCmsCollections);
    socket.on("cmsCollectionItemUpdated", loadCmsCollections);
    socket.on("cmsCollectionItemDeleted", loadCmsCollections);

    socket.on("newArticle", (article) => addOrUpdateArticle(article));
    socket.on("updatedArticle", (article) => addOrUpdateArticle(article));
    socket.on("deletedArticle", (data) => { if (data && data.id) $(`#article-${data.id}`).remove(); });
    socket.on("newDonation", (donation) => addDonation(donation));
  });

  // ── SITE DATA (legacy global settings only — the old partner grid this
  // used to also drive was replaced entirely by the CMS collections system) ──
  async function loadSiteData() {
    try {
      const response = await fetch("/api/site-data");
      if (!response.ok) return;
      const data = await response.json();
      if (data.settings) applySettings(data.settings);
    } catch (e) { console.error("Site data error:", e); }
  }

  // ── CMS SECTIONS: applies individual field changes (text, headings, images) ──
  async function loadCmsSections() {
    try {
      const response = await fetch(`/api/cms/sections?page=${encodeURIComponent(currentPage)}`);
      if (response.ok) {
        const sections = await response.json();
        sections.filter((s) => s.is_active).forEach(applySection);
      }

      const responseGlobal = await fetch(`/api/cms/sections?page=global`);
      if (responseGlobal.ok) {
        const globalSections = await responseGlobal.json();
        globalSections.filter((s) => s.is_active).forEach(applySection);
      }

      // Once the office address (Contact page) is in place, point the
      // embedded map at it. Reads the live CMS text rather than any fixed
      // address, so the map always matches whatever the admin has set.
      updateContactMap();
    } catch (e) { console.error("CMS sections error:", e); }
  }

  function applySection(section) {
    if (!section || !section.selector) return;
    const page = section.page_path.toLowerCase();
    if (page !== currentPage && page !== 'global') return;
    if (section.selector === ".header-carousel") return;

    // Use querySelectorAll to catch ALL matching elements
    // (Owl Carousel clones slides, creating duplicate [data-cms-id] nodes)
    const targets = document.querySelectorAll(section.selector);
    if (!targets.length || !section.content_html) return;

    const val = section.content_html;
    const key = section.section_key || "";

    targets.forEach(function(target) {
      // Hero background images & section backgrounds
      if (key.includes("-hero-bg") || key.includes("-slide-") || key.includes("-bg")) {
        target.style.backgroundImage = `url("${val}")`;
        target.style.backgroundSize = "cover";
        target.style.backgroundPosition = "center";
        return;
      }

      // Direct image tag — just update src
      if (target.tagName === "IMG") {
        target.src = val;
        target.style.display = "";
        return;
      }

      // Iframe (video embed URLs) — update src attribute
      if (target.tagName === "IFRAME") {
        let embedVal = val;
        const ytId = extractYoutubeId(embedVal);
        if (ytId) embedVal = `https://www.youtube.com/embed/${ytId}`;
        target.src = embedVal;
        return;
      }

      // Key contains -img- or -photo: find child img and update src
      if (key.includes("-img-") || key.includes("-photo")) {
        const img = target.querySelector("img");
        if (img) { img.src = val; return; }
      }

      // Link href
      if (target.tagName === "A" && val.match(/^(https?:\/\/|\/|#)/) && !val.includes(" ") && val.length < 200) {
        target.href = val;
        return;
      }

      // Default: text / html content
      target.innerHTML = val;
    });
  }

  function handleCmsSectionChange(section) {
    if (!section) return;
    const page = section.page_path.toLowerCase();
    if (page !== currentPage && page !== 'global') return;
    if (section.is_active) applySection(section);
  }

  // ── SHARED HELPERS ──

  // Pulls a YouTube video ID out of any common URL shape (watch, youtu.be,
  // embed, shorts). Returns null if the URL isn't a recognizable YouTube link.
  function extractYoutubeId(url) {
    if (!url) return null;
    url = url.trim();
    let id = null;
    if (url.includes("youtu.be/")) id = url.split("youtu.be/")[1];
    else if (url.includes("youtube.com/watch")) {
      const q = url.split("?")[1];
      if (q) id = new URLSearchParams(q).get("v");
    } else if (url.includes("youtube.com/embed/")) id = url.split("youtube.com/embed/")[1];
    else if (url.includes("youtube.com/shorts/")) id = url.split("youtube.com/shorts/")[1];
    if (id) id = id.split("?")[0].split("&")[0].split("/")[0];
    return id || null;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // Safely (re)initializes an auto-playing Owl Carousel on a container that
  // was just given fresh innerHTML. Only turns on loop/autoplay/nav once
  // there are actually MORE items than fit in view at once — this is the
  // same fix applied to the old Network Highlights carousel, generalized so
  // every new slider (partners/photos/videos/news/reports) never falls into
  // the "clone a single item to fill empty slots" trap.
  function initAutoSlider($el, opts) {
    if (!$el || !$el.length || !$.fn.owlCarousel) return;
    if ($el.hasClass("owl-loaded")) {
      $el.trigger("destroy.owl.carousel");
      $el.removeClass("owl-loaded owl-carousel");
    }
    $el.addClass("owl-carousel");
    const count = $el.children().length;
    const maxVisible = opts.maxVisible || 3;
    const loopEnabled = count > maxVisible;
    $el.owlCarousel({
      items: 1,
      loop: loopEnabled,
      autoplay: count > 1,
      autoplayTimeout: opts.autoplayTimeout || 4200,
      autoplayHoverPause: true,
      smartSpeed: 800,
      margin: opts.margin != null ? opts.margin : 24,
      dots: true,
      nav: loopEnabled,
      navText: ['<i class="fa fa-chevron-left"></i>', '<i class="fa fa-chevron-right"></i>'],
      responsive: opts.responsive || {
        0: { items: 1 },
        576: { items: Math.min(2, count) || 1 },
        992: { items: Math.min(maxVisible, count) || 1 },
      },
    });
  }

  // ── CMS COLLECTIONS ──
  async function loadCmsCollections() {
    try {
      const response = await fetch("/api/cms/collections");
      if (!response.ok) return;
      const items = await response.json();
      const active = items.filter((x) => x.is_active);

      renderPhotos(active.filter((x) => x.collection_key === "photos"));
      renderVideos(active.filter((x) => x.collection_key === "videos"));
      renderNews(active.filter((x) => x.collection_key === "news"));
      renderOpportunities(active.filter((x) => x.collection_key === "opportunities"));
      renderCollectionPartners(active.filter((x) => x.collection_key === "partners"));

    } catch (e) { console.error("CMS collections error:", e); }
  }

  // ── PHOTOS ──
  function renderPhotos(items) {
    const container = $("#dynamicPhotoGallery");
    if (!container.length) return;
    updateHubCount("#galleryPhotoCount", items.length, "photo");

    if (!Array.isArray(items) || items.length === 0) {
      container.removeClass("owl-carousel m-slider");
      container.html('<div class="col-12"><div class="m-empty"><i class="fa fa-image"></i>No photos have been added yet.</div></div>');
      return;
    }

    if (container.hasClass("owl-loaded")) {
      container.trigger("destroy.owl.carousel");
      container.removeClass("owl-loaded owl-carousel");
    }

    const renderCard = (p) => `
      <div class="m-photo-card" onclick="window.openFenuLightbox('${encodeURIComponent(p.image_url || "")}', '${encodeURIComponent(p.title || "")}')">
        <img src="${p.image_url || ""}" alt="${escapeHtml(p.title)}" loading="lazy">
        <div class="m-photo-overlay">
          <div>
            <h6>${escapeHtml(p.title)}</h6>
            ${p.description ? `<span>${escapeHtml(p.description)}</span>` : ""}
          </div>
        </div>
      </div>`;

    const allCardsHtml = items.map(renderCard).join("");

    container.html(`
      <div class="work-slider-wrapper">
        <div class="work-slider-track">
          ${allCardsHtml}
          ${allCardsHtml}
        </div>
      </div>
    `);
  }

  // Simple built-in lightbox — click a photo, see it full-size, click
  // anywhere (or the close button) to dismiss. No external library needed.
  window.openFenuLightbox = function (encodedUrl, encodedTitle) {
    const url = decodeURIComponent(encodedUrl);
    const title = decodeURIComponent(encodedTitle);
    let $lb = $("#fenuLightbox");
    if (!$lb.length) {
      $("body").append(`
        <div id="fenuLightbox" style="display:none;position:fixed;inset:0;z-index:2000;background:rgba(16,28,51,0.94);align-items:center;justify-content:center;flex-direction:column;padding:30px;cursor:zoom-out;">
          <img id="fenuLightboxImg" src="" alt="" style="max-width:90vw;max-height:80vh;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,0.5);">
          <p id="fenuLightboxCaption" style="color:#fff;margin-top:18px;font-size:1rem;opacity:0.85;"></p>
          <button type="button" style="position:absolute;top:24px;right:28px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.3);color:#fff;width:42px;height:42px;border-radius:50%;font-size:1.1rem;" aria-label="Close">&times;</button>
        </div>`);
      $lb = $("#fenuLightbox");
      $lb.on("click", function () { $lb.fadeOut(150); });
    }
    $("#fenuLightboxImg").attr("src", url);
    $("#fenuLightboxCaption").text(title);
    $lb.css("display", "flex").hide().fadeIn(150);
  };

  // ── VIDEOS (YouTube only) ──
  function renderVideos(items) {
    const container = $("#dynamicVideoGallery");
    if (!container.length) return;
    updateHubCount("#galleryVideoCount", items.length, "video");

    if (!Array.isArray(items) || items.length === 0) {
      container.removeClass("owl-carousel m-slider");
      container.html('<div class="col-12"><div class="m-empty"><i class="fa fa-video"></i>No videos have been added yet.</div></div>');
      return;
    }

    if (container.hasClass("owl-loaded")) {
      container.trigger("destroy.owl.carousel");
      container.removeClass("owl-loaded owl-carousel");
    }

    // 1. Hero row items
    const featured = items[0];
    const fYtId = extractYoutubeId(featured.link_url);
    const fThumb = fYtId ? `https://img.youtube.com/vi/${fYtId}/hqdefault.jpg` : "";

    let heroHtml = `
      <div class="m-video-hero-row" id="videosHeroRow">
        <div class="m-video-featured-col">
          <div class="m-video-hero-card m-fade-up">
            <div class="m-video-thumb-wrap" ${fYtId ? `data-youtube-id="${fYtId}" onclick="window.playFenuVideo(this)"` : ""}>
              ${fThumb ? `<img src="${fThumb}" alt="${escapeHtml(featured.title)}" loading="lazy">` : '<div class="d-flex align-items-center justify-content-center h-100 text-white-50"><i class="fa fa-video fa-2x"></i></div>'}
              ${fYtId ? `
                <div class="m-video-overlay-btn">
                  <span class="tag-pill">VIDEO</span>
                  <div class="play-circle"><i class="fa fa-play"></i></div>
                  <h3 class="video-title">${escapeHtml(featured.title)}</h3>
                </div>
              ` : ""}
            </div>
          </div>
        </div>
    `;

    // Stacked pair is items[1..2]
    const pairItems = items.slice(1, 3);
    if (pairItems.length > 0) {
      heroHtml += `
        <div class="m-video-pair-col">
          ${pairItems.map((v, i) => {
            const ytId = extractYoutubeId(v.link_url);
            const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : "";
            return `
              <div class="m-video-pair-card m-fade-up" style="animation-delay:${(i + 1) * 0.1}s">
                <div class="m-video-thumb-wrap" ${ytId ? `data-youtube-id="${ytId}" onclick="window.playFenuVideo(this)"` : ""}>
                  ${thumb ? `<img src="${thumb}" alt="${escapeHtml(v.title)}" loading="lazy">` : '<div class="d-flex align-items-center justify-content-center h-100 text-white-50"><i class="fa fa-video fa-2x"></i></div>'}
                  ${ytId ? `
                    <div class="m-video-overlay-btn">
                      <span class="tag-pill">VIDEO</span>
                      <div class="play-circle"><i class="fa fa-play"></i></div>
                      <h3 class="video-title">${escapeHtml(v.title)}</h3>
                    </div>
                  ` : ""}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    heroHtml += `</div>`; // End of m-video-hero-row

    // 2. More Videos row (items[3+])
    let moreHtml = "";
    const moreItems = items.slice(3);
    if (moreItems.length > 0) {
      moreHtml = `
        <div class="m-video-more-section">
          <div class="m-video-more-layout">
            <div class="m-video-more-info m-fade-up">
              <h3 data-cms-id="videos-more-title">More Videos</h3>
              <p data-cms-id="videos-more-desc">Explore more of our advocacy and impact stories from the field.</p>
              <a href="#videosHeroRow" class="m-pub-btn-black text-center" style="text-decoration:none;" data-cms-id="videos-more-btn">View All Videos</a>
            </div>
            <div class="m-video-more-grid">
              ${moreItems.map((v, i) => {
                const ytId = extractYoutubeId(v.link_url);
                const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : "";
                return `
                  <div class="m-video-grid-card m-fade-up" style="animation-delay:${(i % 4) * 0.05}s">
                    <div class="m-video-thumb-wrap" ${ytId ? `data-youtube-id="${ytId}" onclick="window.playFenuVideo(this)"` : ""}>
                      ${thumb ? `<img src="${thumb}" alt="${escapeHtml(v.title)}" loading="lazy">` : '<div class="d-flex align-items-center justify-content-center h-100 text-white-50"><i class="fa fa-video fa-2x"></i></div>'}
                      ${ytId ? `
                        <div class="m-video-overlay-btn">
                          <span class="tag-pill">VIDEO</span>
                          <div class="play-circle"><i class="fa fa-play"></i></div>
                          <h3 class="video-title">${escapeHtml(v.title)}</h3>
                        </div>
                      ` : ""}
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        </div>
      `;
    }

    container.html(`
      <div class="col-12">
        ${heroHtml}
        ${moreHtml}
      </div>
    `);
  }

  // Swaps a clicked video thumbnail for a live, autoplaying YouTube embed.
  window.playFenuVideo = function (el) {
    const id = el.getAttribute("data-youtube-id");
    if (!id) return;
    el.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0" title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%;height:100%;border:0;"></iframe>`;
  };

  // ── NEWS ──
  function getArticleContent(item) {
    try {
      const extra = item.extra_json ? JSON.parse(item.extra_json) : {};
      return extra && extra.content ? extra.content : "";
    } catch (e) { return ""; }
  }

  function renderNews(items) {
    const container = $("#dynamicNewsGrid");
    if (!container.length) return;
    updateHubCount("#pubNewsCount", items.length, "article");

    if (!Array.isArray(items) || items.length === 0) {
      container.removeClass("owl-carousel m-slider");
      container.html('<div class="col-12"><div class="m-empty"><i class="fa fa-newspaper"></i>No news articles have been published yet.</div></div>');
      return;
    }

    if (container.hasClass("owl-loaded")) {
      container.trigger("destroy.owl.carousel");
      container.removeClass("owl-loaded owl-carousel");
    }

    window.fenuNewsItems = items;

    // Featured item is items[0]
    const featured = items[0];
    const featuredDate = new Date(featured.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const featuredContent = getArticleContent(featured) || featured.description || "";
    const featuredWords = featuredContent.split(/\s+/).length;
    const featuredReadTime = Math.max(1, Math.ceil(featuredWords / 200));

    // List items are items[1..3]
    const listItems = items.slice(1, 4);

    let listHtml = "";
    if (listItems.length > 0) {
      listHtml = `
        <div class="m-pub-list-col">
          ${listItems.map((item, i) => {
            const date = new Date(item.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
            const itemContent = getArticleContent(item) || item.description || "";
            const itemWords = itemContent.split(/\s+/).length;
            const itemReadTime = Math.max(1, Math.ceil(itemWords / 200));
            return `
              <div class="m-pub-list-item m-fade-up" style="animation-delay:${(i % 3) * 0.05}s">
                <div class="m-pub-list-img-wrap">
                  <img src="${item.image_url || "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=300"}" alt="${escapeHtml(item.title)}" loading="lazy">
                  <span class="m-pub-tag">NEWS</span>
                </div>
                <div class="m-pub-list-content">
                  <div>
                    <div class="m-pub-meta">
                      <span><i class="fa fa-calendar"></i> ${date}</span>
                      <span><i class="fa fa-clock"></i> ${itemReadTime} min read</span>
                    </div>
                    <h4><a href="javascript:void(0)" onclick="window.openFenuArticle(${item.id})">${escapeHtml(item.title)}</a></h4>
                  </div>
                  <button class="m-pub-btn-outline" onclick="window.openFenuArticle(${item.id})">Read More</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    container.html(`
      <div class="m-pub-layout col-12">
        <div class="m-pub-featured-col">
          <div class="m-pub-featured m-fade-up">
            <div class="m-pub-featured-img-wrap">
              <img src="${featured.image_url || "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=800"}" alt="${escapeHtml(featured.title)}" loading="lazy">
              <span class="m-pub-tag">NEWS</span>
            </div>
            <div class="m-pub-featured-body">
              <div class="m-pub-meta">
                <span><i class="fa fa-calendar"></i> ${featuredDate}</span>
                <span><i class="fa fa-clock"></i> ${featuredReadTime} min read</span>
              </div>
              <h3><a href="javascript:void(0)" onclick="window.openFenuArticle(${featured.id})">${escapeHtml(featured.title)}</a></h3>
              <p>${escapeHtml(featured.description || "")}</p>
              <button class="m-pub-btn-black" onclick="window.openFenuArticle(${featured.id})">Read Article <i class="fa fa-arrow-right"></i></button>
            </div>
          </div>
        </div>
        ${listHtml}
      </div>
    `);
  }

  function renderOpportunities(items) {
    const container = $("#dynamicOpportunitiesGrid");
    if (!container.length) return;
    updateHubCount("#pubOpportunityCount", items.length, "opportunity");

    if (!Array.isArray(items) || items.length === 0) {
      container.removeClass("owl-carousel m-slider");
      container.html('<div class="col-12"><div class="m-empty"><i class="fa fa-briefcase"></i>No opportunities have been published yet.</div></div>');
      return;
    }

    if (container.hasClass("owl-loaded")) {
      container.trigger("destroy.owl.carousel");
      container.removeClass("owl-loaded owl-carousel");
    }

    window.fenuOpportunityItems = items;

    const featured = items[0];
    const featuredDate = new Date(featured.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const featuredContent = getArticleContent(featured) || featured.description || "";
    const featuredWords = featuredContent.split(/\s+/).length;
    const featuredReadTime = Math.max(1, Math.ceil(featuredWords / 200));
    const listItems = items.slice(1, 4);

    let listHtml = "";
    if (listItems.length > 0) {
      listHtml = `
        <div class="m-pub-list-col">
          ${listItems.map((item, i) => {
            const date = new Date(item.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
            const itemContent = getArticleContent(item) || item.description || "";
            const itemWords = itemContent.split(/\s+/).length;
            const itemReadTime = Math.max(1, Math.ceil(itemWords / 200));
            return `
              <div class="m-pub-list-item m-fade-up" style="animation-delay:${(i % 3) * 0.05}s">
                <div class="m-pub-list-img-wrap">
                  <img src="${item.image_url || "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=300"}" alt="${escapeHtml(item.title)}" loading="lazy">
                  <span class="m-pub-tag">OPPORTUNITY</span>
                </div>
                <div class="m-pub-list-content">
                  <div>
                    <div class="m-pub-meta">
                      <span><i class="fa fa-calendar"></i> ${date}</span>
                      <span><i class="fa fa-clock"></i> ${itemReadTime} min read</span>
                    </div>
                    <h4><a href="javascript:void(0)" onclick="window.openFenuOpportunity(${item.id})">${escapeHtml(item.title)}</a></h4>
                  </div>
                  <button class="m-pub-btn-outline" onclick="window.openFenuOpportunity(${item.id})">Read More</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    container.html(`
      <div class="m-pub-layout col-12">
        <div class="m-pub-featured-col">
          <div class="m-pub-featured m-fade-up">
            <div class="m-pub-featured-img-wrap">
              <img src="${featured.image_url || "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800"}" alt="${escapeHtml(featured.title)}" loading="lazy">
              <span class="m-pub-tag">OPPORTUNITY</span>
            </div>
            <div class="m-pub-featured-body">
              <div class="m-pub-meta">
                <span><i class="fa fa-calendar"></i> ${featuredDate}</span>
                <span><i class="fa fa-clock"></i> ${featuredReadTime} min read</span>
              </div>
              <h3><a href="javascript:void(0)" onclick="window.openFenuOpportunity(${featured.id})">${escapeHtml(featured.title)}</a></h3>
              <p>${escapeHtml(featured.description || "")}</p>
              <button class="m-pub-btn-black" onclick="window.openFenuOpportunity(${featured.id})">Read Opportunity <i class="fa fa-arrow-right"></i></button>
            </div>
          </div>
        </div>
        ${listHtml}
      </div>
    `);
  }

  window.openFenuOpportunity = function (id) {
    const items = window.fenuOpportunityItems || [];
    const item = items.find((n) => n.id === id);
    if (!item) return;
    const date = new Date(item.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const content = getArticleContent(item) || item.description || "";

    $("#fenuArticleTitle").text(item.title);
    $("#fenuArticleMeta").text(date);
    $("#fenuArticleBody").text(content);
    if (item.image_url) {
      $("#fenuArticleImg").attr("src", item.image_url).show();
    } else {
      $("#fenuArticleImg").hide();
    }

    window.fenuCurrentArticle = { title: item.title, date, content };

    const modalEl = document.getElementById("fenuArticleModal");
    if (modalEl && window.bootstrap) {
      new window.bootstrap.Modal(modalEl).show();
    }
  };

  // Opens the shared article-reading modal (markup lives once in news.html)
  // and wires up its "Download PDF" button for this specific article.
  window.openFenuArticle = function (id) {
    const items = window.fenuNewsItems || window.fenuOpportunityItems || [];
    const item = items.find((n) => n.id === id);
    if (!item) return;
    const date = new Date(item.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const content = getArticleContent(item) || item.description || "";

    $("#fenuArticleTitle").text(item.title);
    $("#fenuArticleMeta").text(date);
    $("#fenuArticleBody").text(content);
    if (item.image_url) {
      $("#fenuArticleImg").attr("src", item.image_url).show();
    } else {
      $("#fenuArticleImg").hide();
    }

    window.fenuCurrentArticle = { title: item.title, date, content };

    const modalEl = document.getElementById("fenuArticleModal");
    if (modalEl && window.bootstrap) {
      new window.bootstrap.Modal(modalEl).show();
    }
  };

  // Generates a simple, readable PDF of the currently-open article on the
  // fly (client-side, via jsPDF) so visitors can download what they're
  // reading without the admin needing to upload a separate file per article.
  window.downloadFenuArticlePdf = function () {
    const article = window.fenuCurrentArticle;
    if (!article || !window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 56;
    const pageWidth = doc.internal.pageSize.getWidth();
    const usableWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    const titleLines = doc.splitTextToSize(article.title, usableWidth);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 22 + 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`FENU Uganda — ${article.date}`, margin, y);
    y += 26;

    doc.setTextColor(30);
    doc.setFontSize(11.5);
    const bodyLines = doc.splitTextToSize(article.content || "", usableWidth);
    const pageHeight = doc.internal.pageSize.getHeight();
    bodyLines.forEach((line) => {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 16;
    });

    const safeName = (article.title || "article").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    doc.save(`${safeName || "fenu-article"}.pdf`);
  };

  // ── PARTNERS ──
  function renderCollectionPartners(partners) {
    if (!Array.isArray(partners)) return;
    const container = $("#dynamicPartnersPageGrid");
    if (!container.length) return;

    if (partners.length === 0) {
      container.html('<div class="m-empty w-100"><i class="fa fa-handshake"></i>No partners have been added yet.</div>');
      return;
    }

    if (container.hasClass("owl-loaded")) {
      container.trigger("destroy.owl.carousel");
      container.removeClass("owl-loaded owl-carousel");
    }

    container.html(`
      <div class="m-partner-grid">
        ${partners.map((p, i) => `
          <div class="m-partner-grid-card m-fade-up" style="animation-delay:${(i % 6) * 0.05}s">
            <img src="${p.image_url || ""}" alt="${escapeHtml(p.title)} logo" loading="lazy">
          </div>
        `).join("")}
      </div>
    `);
  }

  function applySettings(settings) {
    if (settings && settings.site_title) {
      document.title = `${settings.site_title} | FENU Uganda`;
    }
  }

  // Small live counters shown on the Gallery/Publications hub pages
  // ("24 photos", "6 videos"...) — pulled from the real collection counts
  // instead of a hardcoded number.
  function updateHubCount(selector, count, noun) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.textContent = `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  // Points the Contact page's embedded map at whatever the Office Address
  // CMS field currently says, so it's never a fixed/hardcoded location.
  function updateContactMap() {
    const addrEl = document.querySelector('[data-cms-id="contact-office"]');
    const mapFrame = document.getElementById("fenuContactMap");
    if (!addrEl || !mapFrame) return;
    const address = (addrEl.textContent || "").trim();
    if (!address) return;
    mapFrame.src = `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  }

  // ── ARTICLES (legacy blog list — kept for any page that opts in via
  // #articleList; not part of the redesigned News/Reports flow) ──
  async function fetchArticles() {
    const list = $("#articleList");
    if (!list.length) return;
    try {
      const r = await fetch("/api/articles");
      if (!r.ok) throw new Error();
      renderArticles(await r.json());
    } catch (e) {
      list.html('<div class="col-12 text-center text-danger">Unable to load articles at this time.</div>');
    }
  }

  function renderArticles(articles) {
    const list = $("#articleList");
    if (!list.length) return;
    if (!Array.isArray(articles) || articles.length === 0) {
      list.html('<div class="col-12 text-center">No articles published yet.</div>');
      return;
    }
    list.html(articles.map((a) => renderArticleCard(a)).join(""));
  }

  function addOrUpdateArticle(article) {
    const list = $("#articleList");
    if (!list.length || !article) return;
    const existing = $(`#article-${article.id}`);
    const card = renderArticleCard(article);
    if (existing.length) existing.replaceWith(card);
    else list.prepend(card);
  }

  function renderArticleCard(article) {
    const date = new Date(article.created_at).toLocaleDateString();
    return `
      <div class="col-12 col-md-6 col-lg-4" id="article-${article.id}">
        <div class="card border-0 shadow-sm h-100">
          <img src="${article.image_url || "img/blog-1.jpg"}" class="card-img-top" alt="${article.title}">
          <div class="card-body">
            <h5 class="card-title">${article.title}</h5>
            <p class="card-text">${article.content.substring(0, 120)}...</p>
          </div>
          <div class="card-footer bg-white border-0">
            <small class="text-muted">${article.author} • ${date}</small>
          </div>
        </div>
      </div>`;
  }

  // ── REPORTS (reports.html) ──
  function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function fetchReports() {
    const grid = $("#reportsGrid");
    if (!grid.length) return;
    try {
      const r = await fetch("/api/reports");
      if (!r.ok) throw new Error();
      renderReports(await r.json());
    } catch (e) {
      grid.html('<div class="col-12"><div class="m-empty"><i class="fa fa-triangle-exclamation"></i>Unable to load reports right now.</div></div>');
    }
  }

  function renderReports(reports) {
    const grid = $("#reportsGrid");
    if (!grid.length) return;
    updateHubCount("#pubReportCount", Array.isArray(reports) ? reports.length : 0, "report");

    if (!Array.isArray(reports) || reports.length === 0) {
      grid.removeClass("owl-carousel m-slider");
      grid.html('<div class="col-12"><div class="m-empty"><i class="fa fa-file-pdf"></i>No reports have been published yet.</div></div>');
      return;
    }

    if (grid.hasClass("owl-loaded")) {
      grid.trigger("destroy.owl.carousel");
      grid.removeClass("owl-loaded owl-carousel");
    }

    const featured = reports[0];
    const featuredDate = new Date(featured.created_at || Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const featuredSize = featured.size_bytes ? formatFileSize(featured.size_bytes) : "Unknown Size";

    const listItems = reports.slice(1, 4);

    let listHtml = "";
    if (listItems.length > 0) {
      listHtml = `
        <div class="m-pub-list-col">
          ${listItems.map((item, i) => {
            const date = new Date(item.created_at || Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
            const itemSize = item.size_bytes ? formatFileSize(item.size_bytes) : "Unknown Size";
            return `
              <div class="m-pub-list-item m-fade-up" style="animation-delay:${(i % 3) * 0.05}s">
                <div class="m-pub-list-img-wrap" style="background-color: var(--m-cream); display: flex; align-items: center; justify-content: center;">
                  <i class="fa fa-file-pdf text-danger" style="font-size: 3rem;"></i>
                  <span class="m-pub-tag">REPORT</span>
                </div>
                <div class="m-pub-list-content">
                  <div>
                    <div class="m-pub-meta">
                      <span><i class="fa fa-calendar"></i> ${date}</span>
                      <span><i class="fa fa-hdd"></i> ${itemSize}</span>
                    </div>
                    <h4><a href="${item.pdf_url || "javascript:void(0)"}" download target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h4>
                  </div>
                  ${item.pdf_url 
                    ? `<a href="${item.pdf_url}" class="m-pub-btn-outline" download target="_blank" rel="noopener"><i class="fa fa-download"></i> Download</a>`
                    : '<span class="text-muted small">PDF coming soon</span>'}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    grid.html(`
      <div class="m-pub-layout col-12">
        <div class="m-pub-featured-col">
          <div class="m-pub-featured m-fade-up">
            <div class="m-pub-featured-img-wrap" style="background-color: var(--m-cream); display: flex; align-items: center; justify-content: center; aspect-ratio: 16/10;">
              <i class="fa fa-file-pdf text-danger" style="font-size: 6rem;"></i>
              <span class="m-pub-tag">REPORT</span>
            </div>
            <div class="m-pub-featured-body">
              <div class="m-pub-meta">
                <span><i class="fa fa-calendar"></i> ${featuredDate}</span>
                <span><i class="fa fa-hdd"></i> ${featuredSize}</span>
              </div>
              <h3><a href="${featured.pdf_url || "javascript:void(0)"}" download target="_blank" rel="noopener">${escapeHtml(featured.title)}</a></h3>
              <p>${escapeHtml(featured.description || "")}</p>
              ${featured.pdf_url 
                ? `<a href="${featured.pdf_url}" class="m-pub-btn-black" download target="_blank" rel="noopener"><i class="fa fa-download"></i> Download PDF</a>`
                : '<span class="text-muted small">PDF coming soon</span>'}
            </div>
          </div>
        </div>
        ${listHtml}
      </div>
    `);
  }

  // ── DONATIONS (legacy — kept for any page that opts in via #donationList) ──
  async function fetchDonations() {
    const list = $("#donationList");
    if (!list.length) return;
    try {
      const r = await fetch("/api/donations");
      if (!r.ok) throw new Error();
      renderDonations(await r.json());
    } catch (e) {
      list.html('<div class="col-12 text-center text-danger">Unable to load donations at this time.</div>');
    }
  }

  function renderDonations(donations) {
    const list = $("#donationList");
    if (!list.length) return;
    if (!Array.isArray(donations) || donations.length === 0) {
      list.html('<div class="col-12 text-center">No donations have been recorded yet.</div>');
      return;
    }
    list.html(donations.map((d) => {
      const date = new Date(d.donated_at).toLocaleDateString();
      return `
        <div class="col-12 col-md-6 col-lg-4">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h5 class="card-title">${d.donor_name}</h5>
              <p class="card-text">${d.message || "Thank you for supporting our cause."}</p>
            </div>
            <div class="card-footer bg-white border-0">
              <small class="text-muted">${d.currency || "USD"} ${d.amount} • ${date}</small>
            </div>
          </div>
        </div>`;
    }).join(""));
  }

  function addDonation(donation) {
    const list = $("#donationList");
    if (!list.length || !donation) return;
    const date = new Date(donation.donated_at).toLocaleDateString();
    list.prepend(`
      <div class="col-12 col-md-6 col-lg-4">
        <div class="card border-0 shadow-sm h-100">
          <div class="card-body">
            <h5 class="card-title">${donation.donor_name}</h5>
            <p class="card-text">${donation.message || "Thank you for supporting our cause."}</p>
          </div>
          <div class="card-footer bg-white border-0">
            <small class="text-muted">${donation.currency || "USD"} ${donation.amount} • ${date}</small>
          </div>
        </div>
      </div>`);
  }

})(jQuery);
