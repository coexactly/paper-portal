const assert = require("node:assert/strict");
const path = require("node:path");
const DoiCore = require(path.join(__dirname, "..", "src", "doi-core.js"));

function run() {
  testNormalizeDoiUrl();
  testNormalizeDoiNoise();
  testTextExtraction();
  testCurrentUrlExtraction();
  testMetaBeatsCurrentUrl();
  testFallbackTextOnlyWhenNeeded();
  testMetaBeatsReferenceLink();
  testAggregatedSignalsBeatSingleWeakSignal();
  testTitleNormalization();
  testTitleSimilarity();
  testExtractAuthorSurname();
  console.log("All DOI core tests passed.");
}

function testNormalizeDoiUrl() {
  assert.equal(
    DoiCore.normalizeDoi("https://doi.org/10.1000/182"),
    "10.1000/182"
  );
}

function testNormalizeDoiNoise() {
  assert.equal(
    DoiCore.normalizeDoi("doi: 10.1016/S0140-6736(23)00001-2)."),
    "10.1016/S0140-6736(23)00001-2"
  );
}

function testTextExtraction() {
  assert.deepEqual(
    DoiCore.findAllDois("The accepted manuscript DOI is 10.1038/s41586-020-2649-2."),
    ["10.1038/s41586-020-2649-2"]
  );
}

function testCurrentUrlExtraction() {
  const result = DoiCore.extractFromSnapshot({
    currentUrl: "https://iopscience.iop.org/article/10.1088/0031-8949/23/6/002",
    meta: [],
    links: [],
    textBlocks: []
  });

  assert.equal(result.bestCandidate.doi, "10.1088/0031-8949/23/6/002");
  assert.deepEqual(result.bestCandidate.sources, ["current_url"]);
}

function testMetaBeatsCurrentUrl() {
  const result = DoiCore.extractFromSnapshot({
    currentUrl: "https://example.test/article/10.9999/url.1",
    meta: [
      {
        name: "citation_doi",
        content: "10.1111/article.2025.12345"
      }
    ],
    links: [],
    textBlocks: []
  });

  assert.equal(result.bestCandidate.doi, "10.1111/article.2025.12345");
}

function testFallbackTextOnlyWhenNeeded() {
  const withFastEvidence = DoiCore.extractFromSnapshot({
    currentUrl: "https://example.test/article/10.2222/url.2",
    meta: [],
    links: [],
    textBlocks: [],
    fallbackTextBlocks: [
      {
        text: "References 10.9999/reference.4",
        sourceType: "text",
        originHint: "body"
      }
    ]
  });

  assert.equal(withFastEvidence.bestCandidate.doi, "10.2222/url.2");
  assert.equal(withFastEvidence.evidenceCount, 1);

  const fallbackOnly = DoiCore.extractFromSnapshot({
    currentUrl: "https://example.test/article",
    meta: [],
    links: [],
    textBlocks: [],
    fallbackTextBlocks: [
      {
        text: "Article DOI: 10.3333/body.3",
        sourceType: "text",
        originHint: "body"
      }
    ]
  });

  assert.equal(fallbackOnly.bestCandidate.doi, "10.3333/body.3");
}

function testMetaBeatsReferenceLink() {
  const result = DoiCore.extractFromSnapshot({
    currentUrl: "https://example.test/article",
    meta: [
      {
        name: "citation_doi",
        content: "10.1111/article.2025.12345"
      }
    ],
    links: [
      {
        href: "https://doi.org/10.9999/reference.4",
        text: "Reference DOI",
        originHint: "body-link"
      }
    ],
    textBlocks: [
      {
        text: "References 10.9999/reference.4",
        sourceType: "text",
        originHint: "body"
      }
    ]
  });

  assert.equal(result.bestCandidate.doi, "10.1111/article.2025.12345");
}

function testAggregatedSignalsBeatSingleWeakSignal() {
  const result = DoiCore.extractFromSnapshot({
    currentUrl: "https://example.test/article",
    meta: [],
    links: [
      {
        href: "https://doi.org/10.4242/article.7",
        text: "https://doi.org/10.4242/article.7",
        originHint: "article main"
      },
      {
        href: "https://example.test/download",
        text: "10.4242/article.7",
        originHint: "article main"
      },
      {
        href: "https://doi.org/10.6000/reference.3",
        text: "Reference DOI",
        originHint: "body-link"
      }
    ],
    textBlocks: [
      {
        text: "Article DOI: 10.4242/article.7",
        sourceType: "structured_text",
        originHint: "article-header"
      }
    ]
  });

  assert.equal(result.bestCandidate.doi, "10.4242/article.7");
}

function testTitleNormalization() {
  assert.equal(
    DoiCore.normalizePaperTitle("The double scaled limit of Super--Symmetric SYK models"),
    "the double scaled limit of super symmetric syk models"
  );
}

function testTitleSimilarity() {
  assert.ok(
    DoiCore.titleSimilarity(
      "The double scaled limit of super-symmetric SYK models",
      "The double scaled limit of Super--Symmetric SYK models"
    ) > 0.98
  );
}

function testExtractAuthorSurname() {
  assert.equal(DoiCore.extractAuthorSurname("Berkooz, Micha"), "berkooz");
  assert.equal(DoiCore.extractAuthorSurname("Nadav Brukner"), "brukner");
}

run();
