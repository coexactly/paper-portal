browser.runtime.onMessage.addListener(function (message) {
  if (!message || message.type !== "extract-doi-data") {
    return undefined;
  }

  return Promise.resolve(collectPageData());
});

function collectPageData() {
  const isJstorStablePage = DoiCore.isJstorStableUrl(window.location.href);
  const snapshot = {
    currentUrl: window.location.href,
    meta: collectMetaEntries(),
    links: collectLinkEntries(),
    textBlocks: isJstorStablePage ? [] : collectTextBlocks()
  };

  let extraction = DoiCore.extractFromSnapshot(snapshot);

  if (!extraction.bestCandidate && !isJstorStablePage) {
    snapshot.fallbackTextBlocks = collectFallbackTextBlocks();
    extraction = DoiCore.extractFromSnapshot(snapshot);
  }

  return Object.assign({}, extraction, {
    pageTitle: extractBestTitle(snapshot.meta, isJstorStablePage),
    authors: extractAuthors(snapshot.meta),
    publication: extractPublicationMetadata(snapshot.meta)
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

  return blocks;
}

function collectFallbackTextBlocks() {
  const blocks = [];
  const seen = new Set();

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

function extractBestTitle(metaEntries, isJstorStablePage) {
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
      metaCandidates.push(cleanTitleCandidate(entry.content, isJstorStablePage));
    }
  }

  const titleCandidates = metaCandidates
    .concat([
      readFirstText("h1", isJstorStablePage),
      readFirstText("article h1, main h1", isJstorStablePage),
      cleanTitleCandidate(document.title, isJstorStablePage)
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

function extractPublicationMetadata(metaEntries) {
  const publication = {
    types: [],
    isbns: []
  };
  const typeSeen = new Set();
  const isbnSeen = new Set();

  for (const entry of metaEntries) {
    const key = String(entry.name || entry.property || entry.httpEquiv || "").trim().toLowerCase();
    const content = String(entry.content || "").replace(/\s+/g, " ").trim();

    if (!content) {
      continue;
    }

    if (/^(citation_publication_type|dc\.type|prism\.publicationtype|og:type)$/i.test(key)) {
      pushUnique(publication.types, typeSeen, content);
    }

    if (/(^|\.|_)(isbn|eisbn)$/i.test(key) || /\bisbn\b/i.test(key)) {
      for (const isbn of extractIsbns(content)) {
        pushUnique(publication.isbns, isbnSeen, isbn);
      }
    }
  }

  for (const scriptNode of document.querySelectorAll("script[type='application/ld+json']")) {
    collectPublicationFromJsonLd(scriptNode.textContent || "", publication, typeSeen, isbnSeen);
  }

  return publication;
}

function collectPublicationFromJsonLd(rawText, publication, typeSeen, isbnSeen) {
  try {
    const parsed = JSON.parse(rawText);
    collectPublicationNode(parsed, publication, typeSeen, isbnSeen);
  } catch (_error) {
    return;
  }
}

function collectPublicationNode(node, publication, typeSeen, isbnSeen) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectPublicationNode(entry, publication, typeSeen, isbnSeen);
    }
    return;
  }

  if (node["@type"]) {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];

    for (const type of types) {
      pushUnique(publication.types, typeSeen, type);
    }
  }

  const isbnValues = []
    .concat(node.isbn || [])
    .concat(node.isbn13 || [])
    .concat(node.isbn10 || []);

  for (const value of isbnValues) {
    for (const isbn of extractIsbns(value)) {
      pushUnique(publication.isbns, isbnSeen, isbn);
    }
  }

  if (node["@graph"]) {
    collectPublicationNode(node["@graph"], publication, typeSeen, isbnSeen);
  }
}

function extractIsbns(value) {
  const text = String(value || "");
  const matches = text.match(/(?:97[89][-\s]?)?(?:\d[-\s]?){9,12}[\dXx]/g) || [];

  return matches.map(function (match) {
    return match.replace(/[-\s]/g, "").toUpperCase();
  }).filter(function (isbn) {
    return isbn.length === 10 || isbn.length === 13;
  });
}

function pushUnique(list, seen, value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const key = normalized.toLowerCase();

  if (!normalized || seen.has(key)) {
    return;
  }

  seen.add(key);
  list.push(normalized);
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

function cleanTitleCandidate(value, preferFirstSegment) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (preferFirstSegment) {
    const jstorCleaned = cleanJstorTitleCandidate(normalized);

    if (jstorCleaned) {
      return jstorCleaned;
    }
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

function cleanJstorTitleCandidate(value) {
  let result = String(value || "")
    .replace(/\s+on\s+JSTOR\s*$/i, "")
    .replace(/\s*\|\s*JSTOR\s*$/i, "")
    .replace(/\s*-\s*JSTOR\s*$/i, "")
    .trim();
  const separators = [" | ", " - ", " — ", " :: "];

  for (const separator of separators) {
    if (result.indexOf(separator) === -1) {
      continue;
    }

    const first = result.split(separator).map(function (part) {
      return part.trim();
    }).filter(Boolean)[0];

    if (first && first.length >= 12) {
      result = first;
      break;
    }
  }

  return result;
}

function readFirstText(selector, preferFirstSegment) {
  const node = document.querySelector(selector);
  return node ? cleanTitleCandidate(node.textContent || "", preferFirstSegment) : "";
}
