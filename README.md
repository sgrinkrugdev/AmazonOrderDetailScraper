# Amazon Order Detail Scraper

Amazon Configurable Extractor is a Manifest V3 Chrome extension, version 1.3.28, that extracts transactions from an open Amazon account tab and downloads CSV and JSON results.

## Install and run

1. Download and extract this repository, or clone it.
2. Open chrome://extensions and enable Developer mode.
3. Choose Load unpacked and select the folder containing manifest.json.
4. Sign in to Amazon and open Your Payments > Transactions, starting on the newest page. Keep one Amazon tab open.
5. Open the extension popup, select dates, and choose Run extraction. Keep the popup open while it runs.
6. Find amazon-transactions.csv and amazon-transactions-run-log.json in Chrome's configured download directory. Chrome may prompt depending on download settings.

The extension processes pagination and visits order and related transaction pages. It includes handling for refunds, digital orders, Whole Foods, and Amazon Pay. Digital orders can fall back to the order total; the date source identifies that fallback.

## Source files

- manifest.json: configuration and permissions.
- background.js: tab navigation coordinator.
- content2.js: active extraction workflow.
- description.js: product description normalization.
- popup.html, popup.js, popup-defaults.js: controls and export.
- master-reference.js: comparison helpers with an empty reference list.
- content.js and rules.json: legacy files retained from the original folder; not loaded by the current manifest or popup.

## Exports and privacy

CSV output has 13 columns: Credit card, Order number, Date source, Verification, Order amount, Date, MD Verify, MD Match, Item description, MD Failure reason, Transaction type, Order details URL, and Overall Result.

Personal reference order numbers, transaction amounts, and dates have been removed. Without reference rows, Overall Result reports NOT COMPARED (no reference data). Extraction verification remains separate from reference comparison. Session records are stored in Chrome local extension storage and results are downloaded locally.

Do not commit exported transactions, run logs, or personal reference data. If you populate masterRows locally, review changes before committing: .gitignore cannot protect personal edits to tracked source files.

## Current limitations

Original date defaults remain June 1 through September 10, 2026; select dates for each run. The inherited workflow rejects fewer than 100 records for a start date on or before June 1, 2026. Amazon page changes can affect extraction, so review downloaded results. This publication was checked for JavaScript syntax and empty-reference export behavior, but was not tested against a live Amazon account.

## Development

No build step or package installation is required. Check JavaScript syntax with node --check filename.js for each JavaScript file.
