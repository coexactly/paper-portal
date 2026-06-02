const assert = require("node:assert/strict");
const path = require("node:path");
const Background = require(path.join(__dirname, "..", "background.js"));

function run() {
  testModernArxivUrl();
  testOldStyleArxivUrl();
  testBareArchiveIsRejected();
  console.log("All background arXiv tests passed.");
}

function testModernArxivUrl() {
  assert.equal(
    Background.canonicalizeArxivUrl("https://arxiv.org/pdf/2401.12345.pdf"),
    "https://arxiv.org/abs/2401.12345"
  );
}

function testOldStyleArxivUrl() {
  assert.equal(
    Background.canonicalizeArxivUrl("https://arxiv.org/abs/quant-ph/0509043"),
    "https://arxiv.org/abs/quant-ph/0509043"
  );
}

function testBareArchiveIsRejected() {
  assert.equal(
    Background.canonicalizeArxivUrl("https://arxiv.org/abs/quant-ph"),
    null
  );
}

run();
