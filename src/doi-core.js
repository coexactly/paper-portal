(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DoiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DOI_PATTERN = "10\\.\\d{4,9}\\/[\\-._;()/:A-Z0-9]+";
  const HIGH_SIGNAL_META_NAME =
    /^(citation_doi|dc\.identifier|dc\.identifier\.doi|prism\.doi|bepress_citation_doi|rft_id)$/i;
  const DOIISH_META_NAME = /(doi|identifier)/i;
  const HIGH_SIGNAL_TEXT_HINT = /(article|main|abstract|citation|header|hero|title|identifier|doi|ld\+json)/i;
  const TITLE_DIACRITICS = /[\u0300-\u036f]/g;
  const TITLE_PUNCTUATION = /[^a-z0-9]+/g;

  function createDoiRegex(flags) {
    return new RegExp(DOI_PATTERN, flags || "ig");
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  function trimNoise(value) {
    let result = String(value || "").replace(/\u200B/g, "").trim();

    result = result.replace(/^[\s"'`([{<]+/, "");
    result = result.replace(/[.,;:]+$/, "");

    while (/[)\]}>]$/.test(result) && hasMoreClosingBrackets(result)) {
      result = result.slice(0, -1).replace(/[.,;:]+$/, "");
    }

    result = result.replace(/["'`]+$/, "");
    return result.trim();
  }

  function hasMoreClosingBrackets(value) {
    return countChars(value, ")") > countChars(value, "(") ||
      countChars(value, "]") > countChars(value, "[") ||
      countChars(value, "}") > countChars(value, "{") ||
      countChars(value, ">") > countChars(value, "<");
  }

  function countChars(value, needle) {
    let count = 0;

    for (const char of value) {
      if (char === needle) {
        count += 1;
      }
    }

    return count;
  }

  function normalizeDoi(input) {
    if (!input) {
      return null;
    }

    let value = safeDecode(String(input));
    value = value.replace(/^doi:\s*/i, "");
    value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    value = trimNoise(value);

    const match = createDoiRegex("i").exec(value);

    if (!match) {
      return null;
    }

    return trimNoise(match[0]);
  }

  function normalizePaperTitle(input) {
    if (!input) {
      return "";
    }

    const normalized = safeDecode(String(input))
      .normalize("NFKD")
      .replace(TITLE_DIACRITICS, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(TITLE_PUNCTUATION, " ")
      .replace(/\s+/g, " ")
      .trim();

    return normalized;
  }

  function tokenizePaperTitle(input) {
    const normalized = normalizePaperTitle(input);

    if (!normalized) {
      return [];
    }

    return normalized.split(" ").filter(Boolean);
  }

  function titleSimilarity(left, right) {
    const leftTokens = tokenizePaperTitle(left);
    const rightTokens = tokenizePaperTitle(right);

    if (leftTokens.length === 0 || rightTokens.length === 0) {
      return 0;
    }

    if (leftTokens.join(" ") === rightTokens.join(" ")) {
      return 1;
    }

    const counts = new Map();
    let overlap = 0;

    for (const token of leftTokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    for (const token of rightTokens) {
      const remaining = counts.get(token) || 0;

      if (remaining > 0) {
        counts.set(token, remaining - 1);
        overlap += 1;
      }
    }

    return (2 * overlap) / (leftTokens.length + rightTokens.length);
  }

  function extractAuthorSurname(input) {
    if (!input) {
      return "";
    }

    const cleaned = safeDecode(String(input))
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) {
      return "";
    }

    const commaParts = cleaned.split(",").map(function (part) {
      return part.trim();
    }).filter(Boolean);

    let surname = commaParts.length > 1 ? commaParts[0] : cleaned.split(/\s+/).slice(-1)[0];

    surname = surname
      .normalize("NFKD")
      .replace(TITLE_DIACRITICS, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "");

    return surname;
  }

  function findAllDois(text) {
    if (!text) {
      return [];
    }

    const dois = [];
    const seen = new Set();
    const regex = createDoiRegex("ig");
    const decoded = safeDecode(String(text));
    let match;

    while ((match = regex.exec(decoded)) !== null) {
      const normalized = normalizeDoi(match[0]);

      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        dois.push(normalized);
      }
    }

    return dois;
  }

  function scoreEvidence(entry) {
    let score = 0;

    switch (entry.sourceType) {
      case "meta":
        score += 120;
        if (HIGH_SIGNAL_META_NAME.test(entry.originHint || "")) {
          score += 80;
        } else if (DOIISH_META_NAME.test(entry.originHint || "")) {
          score += 30;
        }
        break;
      case "head_link":
        score += 110;
        break;
      case "link_href":
        score += 90;
        break;
      case "link_text":
        score += 55;
        break;
      case "structured_text":
        score += 45;
        break;
      case "text":
        score += 25;
        break;
      default:
        score += 10;
        break;
    }

    if (entry.rawValue && /https?:\/\/(?:dx\.)?doi\.org\//i.test(entry.rawValue)) {
      score += 30;
    }

    if (HIGH_SIGNAL_TEXT_HINT.test(entry.originHint || "")) {
      score += 20;
    }

    return score;
  }

  function pushEvidence(evidence, doi, sourceType, rawValue, originHint) {
    if (!doi) {
      return;
    }

    evidence.push({
      doi,
      sourceType,
      rawValue,
      originHint: originHint || "",
      score: scoreEvidence({
        doi,
        sourceType,
        rawValue,
        originHint
      })
    });
  }

  function collectEvidenceFromSnapshot(snapshot) {
    const evidence = [];
    const metaEntries = Array.isArray(snapshot.meta) ? snapshot.meta : [];
    const linkEntries = Array.isArray(snapshot.links) ? snapshot.links : [];
    const textBlocks = Array.isArray(snapshot.textBlocks) ? snapshot.textBlocks : [];

    for (const meta of metaEntries) {
      const content = meta && meta.content ? String(meta.content) : "";
      const originHint = [meta.name, meta.property, meta.httpEquiv].filter(Boolean).join(" ");

      const normalized = normalizeDoi(content);

      if (normalized) {
        pushEvidence(evidence, normalized, "meta", content, originHint);
      }
    }

    for (const link of linkEntries) {
      const href = link && link.href ? String(link.href) : "";
      const text = link && link.text ? String(link.text) : "";
      const originHint = link && link.originHint ? String(link.originHint) : "";
      const hrefDoi = normalizeDoi(href);
      const textDois = findAllDois(text);

      if (hrefDoi) {
        pushEvidence(
          evidence,
          hrefDoi,
          originHint.indexOf("head:") === 0 ? "head_link" : "link_href",
          href,
          originHint
        );
      }

      for (const textDoi of textDois) {
        pushEvidence(evidence, textDoi, "link_text", text, originHint);
      }
    }

    for (const block of textBlocks) {
      const text = block && block.text ? String(block.text) : "";
      const sourceType = block && block.sourceType ? String(block.sourceType) : "text";
      const originHint = block && block.originHint ? String(block.originHint) : "";

      for (const doi of findAllDois(text)) {
        pushEvidence(evidence, doi, sourceType, text.slice(0, 280), originHint);
      }
    }

    return evidence;
  }

  function rankCandidates(snapshot) {
    const evidence = collectEvidenceFromSnapshot(snapshot);
    const candidateMap = new Map();

    for (const entry of evidence) {
      const existing = candidateMap.get(entry.doi);

      if (existing) {
        existing.score += entry.score;
        existing.evidenceCount += 1;
        existing.sources.add(entry.sourceType);
        existing.rawValues.add(entry.rawValue);
        if (entry.originHint) {
          existing.originHints.add(entry.originHint);
        }
        continue;
      }

      candidateMap.set(entry.doi, {
        doi: entry.doi,
        score: entry.score,
        evidenceCount: 1,
        sources: new Set([entry.sourceType]),
        rawValues: new Set(entry.rawValue ? [entry.rawValue] : []),
        originHints: new Set(entry.originHint ? [entry.originHint] : [])
      });
    }

    const candidates = Array.from(candidateMap.values()).map(function (candidate) {
      return {
        doi: candidate.doi,
        score: candidate.score + Math.min(20, (candidate.evidenceCount - 1) * 5),
        evidenceCount: candidate.evidenceCount,
        sources: Array.from(candidate.sources),
        rawValues: Array.from(candidate.rawValues),
        originHints: Array.from(candidate.originHints)
      };
    });

    candidates.sort(function (left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.evidenceCount !== left.evidenceCount) {
        return right.evidenceCount - left.evidenceCount;
      }

      return left.doi.localeCompare(right.doi);
    });

    return {
      evidence,
      candidates,
      bestCandidate: candidates[0] || null
    };
  }

  function extractFromSnapshot(snapshot) {
    const ranked = rankCandidates(snapshot || {});

    return {
      currentUrl: snapshot && snapshot.currentUrl ? snapshot.currentUrl : "",
      bestCandidate: ranked.bestCandidate,
      candidates: ranked.candidates,
      evidenceCount: ranked.evidence.length
    };
  }

  return {
    DOI_PATTERN,
    collectEvidenceFromSnapshot,
    extractFromSnapshot,
    extractAuthorSurname,
    findAllDois,
    normalizeDoi,
    normalizePaperTitle,
    rankCandidates
    ,
    titleSimilarity,
    tokenizePaperTitle
  };
});
