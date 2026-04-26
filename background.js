const SCIHUB_BASE_KEY = "sciHubBaseUrl";
const DEFAULT_SCIHUB_BASE_URL = "https://sci-hub.ru";
const MENU_OPEN_LINK = "open-link-in-scihub";
const MENU_OPEN_SELECTION = "open-selection-in-scihub";

initialize().catch(function (error) {
  console.error("Initialization failed", error);
});

browser.runtime.onInstalled.addListener(function () {
  initialize().catch(function (error) {
    console.error("onInstalled initialization failed", error);
  });
});

browser.action.onClicked.addListener(function (tab) {
  handleToolbarClick(tab).catch(function (error) {
    console.error("Toolbar action failed", error);
    notifyUser("Could not open arXiv or Sci-Hub for this page.");
  });
});

browser.contextMenus.onClicked.addListener(function (info, tab) {
  handleMenuClick(info, tab).catch(function (error) {
    console.error("Context menu action failed", error);
    notifyUser("Could not open the selected item in Sci-Hub.");
  });
});

browser.storage.onChanged.addListener(function (_changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  initialize().catch(function (error) {
    console.error("Storage change initialization failed", error);
  });
});

async function initialize() {
  await ensureDefaultSettings();
  await rebuildMenus();
}

async function ensureDefaultSettings() {
  const stored = await browser.storage.local.get(SCIHUB_BASE_KEY);

  if (stored[SCIHUB_BASE_KEY]) {
    return;
  }

  await browser.storage.local.set({
    [SCIHUB_BASE_KEY]: DEFAULT_SCIHUB_BASE_URL
  });
}

async function rebuildMenus() {
  browser.contextMenus.removeAll();

  browser.contextMenus.create({
    id: MENU_OPEN_LINK,
    title: "Paper portal",
    contexts: ["link"]
  });

  browser.contextMenus.create({
    id: MENU_OPEN_SELECTION,
    title: "Paper portal",
    contexts: ["selection"]
  });
}

async function handleToolbarClick(tab) {
  if (!tab || typeof tab.id !== "number") {
    await notifyUser("This tab cannot be inspected.");
    return;
  }

  const pageData = await requestPageExtraction(tab.id);
  const arxivUrl = await resolveArxivUrl(pageData);

  if (arxivUrl) {
    await openUrl(arxivUrl);
  }

  const sciHubValue = pageData && pageData.bestCandidate && pageData.bestCandidate.doi
    ? pageData.bestCandidate.doi
    : pageData && pageData.currentUrl ? pageData.currentUrl : tab.url;

  if (!sciHubValue || !/^https?:/i.test(sciHubValue) && !DoiCore.normalizeDoi(sciHubValue)) {
    await notifyUser("No DOI was found, and this page URL cannot be sent to Sci-Hub.");
    return;
  }

  if (!(pageData && pageData.bestCandidate && pageData.bestCandidate.doi)) {
    await notifyUser("No DOI found. Falling back to the page URL for Sci-Hub.");
  }

  await openInSciHub(sciHubValue);
}

async function handleMenuClick(info, tab) {
  if (info.menuItemId === MENU_OPEN_LINK) {
    const doi = DoiCore.normalizeDoi(info.linkUrl);

    if (doi) {
      await openInSciHub(doi);
      return;
    }

    if (info.linkUrl) {
      await notifyUser("No DOI found in this link. Falling back to the link URL.");
      await openInSciHub(info.linkUrl);
      return;
    }

    await notifyUser("The clicked link did not include a DOI or usable URL.");
    return;
  }

  if (info.menuItemId === MENU_OPEN_SELECTION) {
    const doi = DoiCore.normalizeDoi(info.selectionText);

    if (doi) {
      await openInSciHub(doi);
      return;
    }

    const trimmedSelection = (info.selectionText || "").trim();

    if (/^https?:\/\//i.test(trimmedSelection)) {
      await notifyUser("No DOI found in the selection. Falling back to the selected URL.");
      await openInSciHub(trimmedSelection);
      return;
    }

    await notifyUser("The selected text did not contain a DOI.");
    return;
  }

  if (tab && typeof tab.id === "number") {
    await handleToolbarClick(tab);
  }
}

async function requestPageExtraction(tabId) {
  try {
    return await browser.tabs.sendMessage(tabId, {
      type: "extract-doi-data"
    });
  } catch (error) {
    console.warn("Content script was unavailable for the current tab", error);
    return null;
  }
}

async function resolveArxivUrl(pageData) {
  if (!pageData) {
    return null;
  }

  const doi = pageData.bestCandidate && pageData.bestCandidate.doi;

  if (doi) {
    const openAlexUrl = await findArxivViaOpenAlex(doi);

    if (openAlexUrl) {
      return openAlexUrl;
    }
  }

  return findArxivViaSearch(pageData.pageTitle, pageData.authors || []);
}

async function findArxivViaOpenAlex(doi) {
  const endpoint = "https://api.openalex.org/works/" +
    encodeURIComponent("https://doi.org/" + doi) +
    "?select=locations,primary_location,best_oa_location,indexed_in";

  try {
    const payload = await fetchJson(endpoint);
    return extractArxivUrlFromOpenAlex(payload);
  } catch (error) {
    console.warn("OpenAlex lookup failed", error);
    return null;
  }
}

function extractArxivUrlFromOpenAlex(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const locations = [];

  if (payload.primary_location) {
    locations.push(payload.primary_location);
  }

  if (payload.best_oa_location) {
    locations.push(payload.best_oa_location);
  }

  if (Array.isArray(payload.locations)) {
    locations.push.apply(locations, payload.locations);
  }

  for (const location of locations) {
    const candidate = locationToArxivUrl(location);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function locationToArxivUrl(location) {
  if (!location || typeof location !== "object") {
    return null;
  }

  const candidates = [location.landing_page_url, location.pdf_url];

  for (const value of candidates) {
    const candidate = canonicalizeArxivUrl(value);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function canonicalizeArxivUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(String(value));

    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) {
      return null;
    }

    const path = url.pathname || "";
    const absMatch = path.match(/\/abs\/([^/?#]+)/i);

    if (absMatch) {
      return "https://arxiv.org/abs/" + absMatch[1];
    }

    const pdfMatch = path.match(/\/pdf\/([^/?#]+?)(?:\.pdf)?$/i);

    if (pdfMatch) {
      return "https://arxiv.org/abs/" + pdfMatch[1];
    }
  } catch (_error) {
    return null;
  }

  return null;
}

async function findArxivViaSearch(pageTitle, authors) {
  const normalizedTitle = DoiCore.normalizePaperTitle(pageTitle);

  if (!normalizedTitle) {
    return null;
  }

  const queries = [];
  const firstAuthor = Array.isArray(authors) && authors.length > 0 ? authors[0] : "";

  if (firstAuthor) {
    queries.push('ti:"' + escapeArxivPhrase(pageTitle) + '" AND au:"' + escapeArxivPhrase(firstAuthor) + '"');
  }

  queries.push('ti:"' + escapeArxivPhrase(pageTitle) + '"');

  for (const query of queries) {
    const url = await runArxivSearch(query, normalizedTitle, firstAuthor);

    if (url) {
      return url;
    }
  }

  return null;
}

async function runArxivSearch(searchQuery, normalizedTitle, firstAuthor) {
  const endpoint = new URL("https://export.arxiv.org/api/query");
  endpoint.searchParams.set("search_query", searchQuery);
  endpoint.searchParams.set("start", "0");
  endpoint.searchParams.set("max_results", "5");
  endpoint.searchParams.set("sortBy", "relevance");
  endpoint.searchParams.set("sortOrder", "descending");

  try {
    const response = await fetch(endpoint.toString());

    if (!response.ok) {
      return null;
    }

    const xml = await response.text();
    const parsed = parseArxivFeed(xml);
    const best = pickBestArxivMatch(parsed, normalizedTitle, firstAuthor);
    return best ? best.url : null;
  } catch (error) {
    console.warn("arXiv search failed", error);
    return null;
  }
}

function parseArxivFeed(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");

  if (xml.querySelector("parsererror")) {
    return [];
  }

  return Array.from(xml.getElementsByTagName("entry")).map(function (entry) {
    const idNode = entry.getElementsByTagName("id")[0];
    const titleNode = entry.getElementsByTagName("title")[0];
    const authorNodes = Array.from(entry.getElementsByTagName("author"));

    return {
      id: idNode ? idNode.textContent.trim() : "",
      title: titleNode ? titleNode.textContent.replace(/\s+/g, " ").trim() : "",
      authors: authorNodes.map(function (authorNode) {
        const nameNode = authorNode.getElementsByTagName("name")[0];
        return nameNode ? nameNode.textContent.replace(/\s+/g, " ").trim() : "";
      }).filter(Boolean)
    };
  }).filter(function (entry) {
    return entry.id && entry.title;
  });
}

function pickBestArxivMatch(entries, normalizedTitle, firstAuthor) {
  const expectedSurname = DoiCore.extractAuthorSurname(firstAuthor);
  let best = null;

  for (const entry of entries) {
    const similarity = DoiCore.titleSimilarity(normalizedTitle, entry.title);

    if (similarity < 0.92) {
      continue;
    }

    const authorMatch = !expectedSurname || entry.authors.some(function (author) {
      return DoiCore.extractAuthorSurname(author) === expectedSurname;
    });

    if (!authorMatch) {
      continue;
    }

    const candidate = {
      url: canonicalizeArxivUrl(entry.id),
      similarity: similarity
    };

    if (!candidate.url) {
      continue;
    }

    if (!best || candidate.similarity > best.similarity) {
      best = candidate;
    }
  }

  return best;
}

function escapeArxivPhrase(value) {
  return String(value || "").replace(/"/g, "");
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Request failed with status " + response.status);
  }

  return response.json();
}

async function openInSciHub(value) {
  const baseUrl = await getSciHubBaseUrl();
  const targetUrl = baseUrl + "/" + encodeSciHubPath(value);

  await openUrl(targetUrl);
}

async function getSciHubBaseUrl() {
  const stored = await browser.storage.local.get(SCIHUB_BASE_KEY);
  return normalizeBaseUrl(stored[SCIHUB_BASE_KEY] || DEFAULT_SCIHUB_BASE_URL);
}

function normalizeBaseUrl(value) {
  const candidate = String(value || DEFAULT_SCIHUB_BASE_URL).trim();
  const parsed = new URL(candidate);

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Sci-Hub base URL must use HTTP or HTTPS.");
  }

  return parsed.href.replace(/\/+$/, "");
}

function encodeSciHubPath(value) {
  return encodeURI(String(value || "").trim())
    .replace(/\?/g, "%3F")
    .replace(/#/g, "%23");
}

async function openUrl(url) {
  await browser.tabs.create({
    url: url
  });
}

async function notifyUser(message) {
  await browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/toolbar.svg"),
    title: "Paper portal",
    message
  });
}
