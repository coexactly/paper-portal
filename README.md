# Paper portal

A Firefox extension that adds:

- a toolbar button that opens the current paper in Sci-Hub using the best DOI found on the page and also opens the corresponding arXiv page when one can be resolved
- context-menu actions for opening Sci-Hub from a clicked link or selected text
- an options page for changing the Sci-Hub base URL when mirrors move

## Files

- `manifest.json`: Firefox Manifest V3 definition
- `src/doi-core.js`: shared DOI normalization and ranking logic
- `background.js`: toolbar click, arXiv lookup, context-menu, notifications, and settings behavior
- `content-script.js`: page inspection and DOI candidate collection
- `options/`: Sci-Hub mirror settings UI
- `tests/doi-core.test.js`: Node-based tests for the ranking logic

## Loading the extension

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `manifest.json` for a quick test.

For persistent personal use, package the extension as an `.xpi` and install it in Firefox Developer Edition or Nightly with unsigned-extension support enabled in that profile.

## Settings

Open the extension's preferences page and set the Sci-Hub mirror you want to use. The default is `https://sci-hub.se`, but the extension is designed so you can replace that without editing code.

## Testing

Run:

```bash
node tests/doi-core.test.js
```
