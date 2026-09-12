// Navigation coordinator for the active-tab extraction workflow.
// The content script persists its cursor in chrome.storage and resumes after
// order-details or related-transactions navigation completes.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACTOR_TAB_ID') { sendResponse({ tabId: sender.tab?.id }); return; }
  if (message.type !== 'NAVIGATE_ACTIVE_TAB' || !sender.tab?.id || !message.url) return;
  chrome.tabs.update(sender.tab.id, { url: message.url }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
