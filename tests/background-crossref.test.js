const assert = require("node:assert/strict");
const path = require("node:path");
const Background = require(path.join(__dirname, "..", "background.js"));
const DoiCore = require(path.join(__dirname, "..", "src", "doi-core.js"));

async function run() {
  testPublicationTypeClassification();
  testLibGenSearchUrlBuilder();
  testLibGenSearchQuery();
  testJstorTitleVariants();
  testJstorStableIdExtraction();
  await testSpringerReferenceWorkResolvesAsBookViaCrossref();
  await testJstorStableTitleResolvesViaCrossref();
  await testJstorStableUrlResolvesViaCitationEndpoint();
  console.log("All background Crossref tests passed.");
}

function testPublicationTypeClassification() {
  assert.equal(Background.classifyPagePublication({
    publication: {
      types: ["Book"],
      isbns: []
    }
  }), "book");

  assert.equal(Background.classifyPagePublication({
    publication: {
      types: ["journal-article"],
      isbns: []
    }
  }), "paper");

  assert.equal(Background.classifyPagePublication({
    publication: {
      types: [],
      isbns: ["9780262033848"]
    }
  }), "book");
}

function testLibGenSearchUrlBuilder() {
  assert.equal(
    Background.buildSearchUrl("https://libgen.li/index.php?req=", "The Book"),
    "https://libgen.li/index.php?req=The%20Book"
  );

  assert.equal(
    Background.buildSearchUrl("https://example.test/search?q={query}&mode=books", "The Book"),
    "https://example.test/search?q=The%20Book&mode=books"
  );
}

function testLibGenSearchQuery() {
  assert.equal(
    Background.buildLibGenSearchQuery({
      pageTitle: "Structure and Interpretation of Computer Programs",
      authors: ["Harold Abelson"],
      publication: {
        isbns: ["9780262510875"]
      }
    }, "10.5555/book"),
    "9780262510875"
  );

  assert.equal(
    Background.buildLibGenSearchQuery({
      pageTitle: "Structure and Interpretation of Computer Programs",
      authors: ["Harold Abelson"],
      publication: {}
    }, "10.5555/book"),
    "Structure and Interpretation of Computer Programs Harold Abelson"
  );
}

function testJstorTitleVariants() {
  assert.deepEqual(
    Background.createCrossrefTitleVariants("The Many Lives of the Twisted Cubic on JSTOR"),
    [
      "The Many Lives of the Twisted Cubic",
      "The Many Lives of the Twisted Cubic on JSTOR"
    ]
  );
}

function testJstorStableIdExtraction() {
  assert.equal(
    Background.extractJstorStableId("https://www.jstor.org/stable/48662152"),
    "48662152"
  );
}

async function testJstorStableTitleResolvesViaCrossref() {
  const doi = await Background.findDoiViaCrossref("The Many Lives of the Twisted Cubic on JSTOR");

  assert.equal(doi, "10.1080/00029890.2019.1601974");
}

async function testJstorStableUrlResolvesViaCitationEndpoint() {
  const doi = await Background.findDoiViaJstorStableUrl("https://www.jstor.org/stable/48662152");

  assert.equal(doi, "10.1080/00029890.2019.1601974");
}

async function testSpringerReferenceWorkResolvesAsBookViaCrossref() {
  const springerUrl = "https://link.springer.com/referencework/10.1007/978-981-99-7681-2";
  const pageData = DoiCore.extractFromSnapshot({
    currentUrl: springerUrl,
    meta: [],
    links: [],
    textBlocks: []
  });
  const doi = await Background.resolvePageDoi(pageData, springerUrl);
  const kind = await Background.resolvePublicationKind(pageData, doi);

  assert.equal(doi, "10.1007/978-981-99-7681-2");
  assert.equal(kind, "book");
}

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
