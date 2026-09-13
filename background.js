try {
  importScripts('master-data.local.js');
} catch (error) {
}
importScripts('master-reference.js', 'export.js');

// Navigation coordinator for the active-tab extraction workflow.
// The content scripts persist cursors in chrome.storage and resume after
// navigation completes.
let exportPromise = null;
let giftCardExportPromise = null;

function sessionExportKey(session) {
  return 'amazonExport:' + (session?.runId || session?.startedAt || `${session?.start || ''}:${session?.end || ''}`);
}

function giftCardSessionExportKey(session) {
  return 'amazonGiftCardExport:' + (session?.runId || session?.startedAt || `${session?.start || ''}:${session?.end || ''}`);
}

async function downloadText(filename, text, mime) {
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  return chrome.downloads.download({ url, filename, saveAs: false });
}

async function exportCompletedSession(session) {
  if (!session || session.phase !== 'completed') return { ok: false, skipped: true };
  if (exportPromise) return exportPromise;
  exportPromise = (async () => {
    const key = sessionExportKey(session);
    const state = (await chrome.storage.local.get(key))[key];
    if (state?.csvId && state?.logId) return { ok: true, alreadyExported: true, key };

    const records = session.records || [];
    const juneStartFailure = session.start <= '2026-06-01' && records.length < 100;
    if (juneStartFailure) {
      const error = 'Pagination failure: fewer than 100 records collected for a June 1 start.';
      const logId = await downloadText('amazon-transactions-run-log.json', JSON.stringify(buildRunLog(session, 'failed', error), null, 2), 'application/json');
      await chrome.storage.local.set({ [key]: { logId, error } });
      throw new Error(error + ' Diagnostic log saved.');
    }

    const csvId = await downloadText('amazon-transactions.csv', csv(records), 'text/csv');
    await chrome.storage.local.set({ [key]: { ...(state || {}), csvId } });
    const logId = await downloadText('amazon-transactions-run-log.json', JSON.stringify(buildRunLog(session, 'completed'), null, 2), 'application/json');
    await chrome.storage.local.set({ [key]: { csvId, logId } });
    return { ok: true, csvId, logId, key };
  })();
  try {
    return await exportPromise;
  } finally {
    exportPromise = null;
  }
}

async function exportGiftCardCompletedSession(session) {
  if (!session || session.phase !== 'completed') return { ok: false, skipped: true };
  if (giftCardExportPromise) return giftCardExportPromise;
  giftCardExportPromise = (async () => {
    const key = giftCardSessionExportKey(session);
    const state = (await chrome.storage.local.get(key))[key];
    if (state?.csvId && state?.logId) return { ok: true, alreadyExported: true, key };
    const csvFilename = session.csvFilename || 'amazon-gift-card-transactions.csv';
    const logFilename = session.logFilename || 'amazon-gift-card-transactions-run-log.json';
    const csvId = await downloadText(csvFilename, giftCardCsv(session.records || []), 'text/csv');
    await chrome.storage.local.set({ [key]: { ...(state || {}), csvId } });
    const logId = await downloadText(logFilename, JSON.stringify(buildGiftCardRunLog(session, 'completed'), null, 2), 'application/json');
    await chrome.storage.local.set({ [key]: { csvId, logId } });
    return { ok: true, csvId, logId, key };
  })();
  try {
    return await giftCardExportPromise;
  } finally {
    giftCardExportPromise = null;
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const session = changes.amazonSession?.newValue;
  if (session?.phase === 'completed') exportCompletedSession(session).catch(error => chrome.storage.local.set({ amazonLastExportError: error.message }));
  const giftCardSession = changes.amazonGiftCardSession?.newValue;
  if (giftCardSession?.phase === 'completed') exportGiftCardCompletedSession(giftCardSession).catch(error => chrome.storage.local.set({ amazonGiftCardLastExportError: error.message }));
});

chrome.storage.local.get(['amazonSession', 'amazonGiftCardSession']).then(({ amazonSession, amazonGiftCardSession }) => {
  if (amazonSession?.phase === 'completed') exportCompletedSession(amazonSession).catch(error => chrome.storage.local.set({ amazonLastExportError: error.message }));
  if (amazonGiftCardSession?.phase === 'completed') exportGiftCardCompletedSession(amazonGiftCardSession).catch(error => chrome.storage.local.set({ amazonGiftCardLastExportError: error.message }));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACTOR_TAB_ID') { sendResponse({ tabId: sender.tab?.id }); return; }
  if (message.type === 'EXPORT_COMPLETED_SESSION') {
    chrome.storage.local.get('amazonSession')
      .then(({ amazonSession }) => exportCompletedSession(amazonSession))
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'EXPORT_GIFT_CARD_COMPLETED_SESSION') {
    chrome.storage.local.get('amazonGiftCardSession')
      .then(({ amazonGiftCardSession }) => exportGiftCardCompletedSession(amazonGiftCardSession))
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type !== 'NAVIGATE_ACTIVE_TAB' || !sender.tab?.id || !message.url) return;
  chrome.tabs.update(sender.tab.id, { url: message.url }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
