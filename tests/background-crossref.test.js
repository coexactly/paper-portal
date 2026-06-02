const assert = require("node:assert/strict");
const path = require("node:path");
const Background = require(path.join(__dirname, "..", "background.js"));

async function run() {
  testJstorTitleVariants();
  testJstorStableIdExtraction();
  await testJstorStableTitleResolvesViaCrossref();
  await testJstorStableUrlResolvesViaCitationEndpoint();
  console.log("All background Crossref tests passed.");
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

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
