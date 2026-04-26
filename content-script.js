browser.runtime.onMessage.addListener(function (message) {
  if (!message || message.type !== "extract-doi-data") {
    return undefined;
  }

  return Promise.resolve(collectPageData());
});

function collectPageData() {
  const snapshot = {
    currentUrl: window.location.href,
    meta: collectMetaEntries(),
    links: collectLinkEntries(),
    textBlocks: collectTextBlocks()
  };

  const extraction = DoiCore.extractFromSnapshot(snapshot);

  return Object.assign({}, extraction, {
    pageTitle: extractBestTitle(snapshot.meta),
    authors: extractAuthors(snapshot.meta)
  });
}

function collectMetaEntries() {
  return Array.from(document.querySelectorAll("meta"))
    .map(function (meta) {
      return {
        name: meta.getAttribute("name") || "",
        property: meta.getAttribute("property") || "",
        httpEquiv: meta.getAttribute("http-equiv") || "",
        content: meta.getAttribute("content") || ""
      };
    })
    .filter(function (entry) {
      return entry.content;
    });
}

function collectLinkEntries() {
  const headLinks = Array.from(document.querySelectorAll("head link[href]")).map(function (link) {
    return {
      href: link.href || "",
      text: "",
      originHint: "head:" + (link.getAttribute("rel") || "link")
    };
  });

  const bodyLinks = Array.from(document.links)
    .slice(0, 2000)
    .map(function (link) {
      return {
        href: link.href || "",
        text: link.textContent || "",
        originHint: describeLinkContext(link)
      };
    });

  return headLinks.concat(bodyLinks);
}

function collectTextBlocks() {
  const blocks = [];
  const seen = new Set();

  pushTextBlock(blocks, seen, document.title, "structured_text", "document-title");

  const selectors = [
    { selector: "article", hint: "article" },
    { selector: "main", hint: "main" },
    { selector: "[role='main']", hint: "role-main" },
    { selector: ".abstract", hint: "abstract" },
    { selector: ".article-header, .article__header, .article-header", hint: "article-header" },
    { selector: ".citation, .article-citation", hint: "citation" },
    { selector: "#main-content", hint: "main-content" }
  ];

  for (const entry of selectors) {
    for (const node of document.querySelectorAll(entry.selector)) {
      pushTextBlock(blocks, seen, node.innerText || "", "structured_text", entry.hint);
    }
  }

  for (const node of document.querySelectorAll("script[type='application/ld+json']")) {
    pushTextBlock(blocks, seen, node.textContent || "", "structured_text", "ld+json");
  }

  pushTextBlock(blocks, seen, document.body ? document.body.innerText || "" : "", "text", "body");

  return blocks;
}

function pushTextBlock(blocks, seen, text, sourceType, originHint) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();

  if (!normalized || normalized.length < 8) {
    return;
  }

  const dedupeKey = normalized.slice(0, 400);

  if (seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  blocks.push({
    text: normalized,
    sourceType: sourceType,
    originHint: originHint
  });
}

function describeLinkContext(link) {
  const parts = [];

  if (link.closest("article")) {
    parts.push("article");
  }

  if (link.closest("main, [role='main'], #main-content")) {
    parts.push("main");
  }

  if (link.closest(".abstract, .citation, .article-citation")) {
    parts.push("citation");
  }

  if (parts.length === 0) {
    parts.push("body-link");
  }

  return parts.join(" ");
}

function extractBestTitle(metaEntries) {
  const preferredMetaNames = [
    "citation_title",
    "dc.title",
    "dc.title",
    "og:title",
    "twitter:title"
  ];
  const metaCandidates = [];

  for (const entry of metaEntries) {
    const keys = [entry.name, entry.property, entry.httpEquiv]
      .filter(Boolean)
      .map(function (value) {
        return String(value).trim().toLowerCase();
      });

    if (!keys.length) {
      continue;
    }

    if (keys.some(function (value) {
      return preferredMetaNames.indexOf(value) !== -1;
    })) {
      metaCandidates.push(cleanTitleCandidate(entry.content));
    }
  }

  const titleCandidates = metaCandidates
    .concat([
      readFirstText("h1"),
      readFirstText("article h1, main h1"),
      cleanTitleCandidate(document.title)
    ])
    .filter(Boolean);

  for (const candidate of titleCandidates) {
    if (candidate.length >= 12) {
      return candidate;
    }
  }

  return titleCandidates[0] || "";
}

function extractAuthors(metaEntries) {
  const authors = [];
  const seen = new Set();

  for (const entry of metaEntries) {
    const name = String(entry.name || entry.property || "").trim().toLowerCase();

    if (!/^(citation_author|dc\.creator|dc\.contributor|author|parsely-author)$/i.test(name)) {
      continue;
    }

    pushAuthorCandidate(authors, seen, entry.content);
  }

  for (const scriptNode of document.querySelectorAll("script[type='application/ld+json']")) {
    const extractedAuthors = extractAuthorsFromJsonLd(scriptNode.textContent || "");

    for (const author of extractedAuthors) {
      pushAuthorCandidate(authors, seen, author);
    }
  }

  return authors.slice(0, 8);
}

function extractAuthorsFromJsonLd(rawText) {
  const authors = [];

  try {
    const parsed = JSON.parse(rawText);
    const nodes = Array.isArray(parsed) ? parsed : [parsed];

    for (const node of nodes) {
      collectJsonLdAuthors(node, authors);
    }
  } catch (_error) {
    return authors;
  }

  return authors;
}

function collectJsonLdAuthors(node, authors) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectJsonLdAuthors(entry, authors);
    }
    return;
  }

  if (node.author) {
    const entries = Array.isArray(node.author) ? node.author : [node.author];

    for (const author of entries) {
      if (typeof author === "string") {
        authors.push(author);
      } else if (author && typeof author.name === "string") {
        authors.push(author.name);
      }
    }
  }

  if (node["@graph"]) {
    collectJsonLdAuthors(node["@graph"], authors);
  }
}

function pushAuthorCandidate(authors, seen, value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return;
  }

  const dedupeKey = normalized.toLowerCase();

  if (seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  authors.push(normalized);
}

function cleanTitleCandidate(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const separators = [" | ", " - ", " — ", " :: "];

  for (const separator of separators) {
    if (normalized.indexOf(separator) === -1) {
      continue;
    }

    const parts = normalized.split(separator).map(function (part) {
      return part.trim();
    }).filter(Boolean);

    if (parts.length > 1) {
      const longest = parts.reduce(function (best, current) {
        return current.length > best.length ? current : best;
      }, "");

      if (longest.length >= 12) {
        return longest;
      }
    }
  }

  return normalized;
}

function readFirstText(selector) {
  const node = document.querySelector(selector);
  return node ? cleanTitleCandidate(node.textContent || "") : "";
}
