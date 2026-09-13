const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = value => $('status').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function defaults() {
  $('start').value = '2026-06-01';
  $('end').value = '2026-09-10';
  $('giftCardCsv').value = 'amazon-gift-card-transactions.csv';
  $('giftCardLog').value = 'amazon-gift-card-transactions-run-log.json';
  $('giftCardMaxPages').value = '120';
  $('giftCardHardYears').value = '1';
}

async function loadConfig() {
  defaults();
  const { amazonExtractorConfig = {} } = await chrome.storage.local.get('amazonExtractorConfig');
  $('start').value = amazonExtractorConfig.start || $('start').value;
  $('end').value = amazonExtractorConfig.end || $('end').value;
  $('giftCardCsv').value = amazonExtractorConfig.giftCardCsv || $('giftCardCsv').value;
  $('giftCardLog').value = amazonExtractorConfig.giftCardLog || $('giftCardLog').value;
  $('giftCardMaxPages').value = amazonExtractorConfig.giftCardMaxPages || $('giftCardMaxPages').value;
  $('giftCardHardYears').value = amazonExtractorConfig.giftCardHardYears || $('giftCardHardYears').value;
}

async function saveConfig() {
  await chrome.storage.local.set({
    amazonExtractorConfig: {
      start: $('start').value,
      end: $('end').value,
      giftCardCsv: $('giftCardCsv').value || 'amazon-gift-card-transactions.csv',
      giftCardLog: $('giftCardLog').value || 'amazon-gift-card-transactions-run-log.json',
      giftCardMaxPages: $('giftCardMaxPages').value || '120',
      giftCardHardYears: $('giftCardHardYears').value || '1'
    }
  });
}

function tabWorkflowScore(tab, workflow) {
  const url = tab?.url || '';
  if (!url) return 0;
  if (workflow === 'gift-card') {
    if (/\/gc\/balance/i.test(url)) return 100;
    if (/gift-card|giftcard/i.test(url)) return 80;
    return 0;
  }
  if (workflow === 'orders') {
    if (/\/gc\/balance|gift-card|giftcard/i.test(url)) return 0;
    if (/\/cpe\/yourpayments\/transactions/i.test(url) && /transactionTag=/i.test(url)) return 95;
    if (/\/cpe\/yourpayments\/transactions/i.test(url)) return 100;
    if (/\/gp\/your-account\/order-details|\/gp\/css\/order-details|\/order-details/i.test(url)) return 80;
    return 0;
  }
  return 1;
}

async function findAmazonTab(workflow) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true, url: ['https://*.amazon.com/*'] });
  const tabs = await chrome.tabs.query({ url: ['https://*.amazon.com/*'] });
  const candidates = [activeTab, ...tabs].filter(Boolean);
  const scored = candidates
    .map(tab => ({ tab, score: tabWorkflowScore(tab, workflow), activeBonus: tab.id === activeTab?.id ? 1 : 0 }))
    .filter(item => item.score > 0)
    .sort((a, b) => (b.score + b.activeBonus) - (a.score + a.activeBonus));
  return scored[0]?.tab || activeTab || tabs[0];
}

async function send(message, workflow) {
  const tab = await findAmazonTab(workflow);
  if (!tab) throw Error('No open Amazon tab found');
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['description.js', 'content2.js', 'giftcard.js'] });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

async function exportCompleted() {
  return chrome.runtime.sendMessage({ type: 'EXPORT_COMPLETED_SESSION' });
}

async function exportGiftCardCompleted() {
  return chrome.runtime.sendMessage({ type: 'EXPORT_GIFT_CARD_COMPLETED_SESSION' });
}

function setRunning(running) {
  $('allRun').disabled = running;
  $('giftCardRun').disabled = running;
  $('run').disabled = running;
  $('stop').disabled = !running;
}

async function getTransactions(options = {}) {
  try {
    setRunning(true);
    await saveConfig();
    await send({ type: 'START_EXTRACTION', start: $('start').value, end: $('end').value }, 'orders');
    let session;
    for (;;) {
      await sleep(1000);
      session = (await chrome.storage.local.get('amazonSession')).amazonSession;
      if (!session) throw Error('Extraction session is missing');
      if (['completed', 'failed', 'stopped'].includes(session?.phase)) break;
      status(`Transactions phase: ${session?.phase || 'starting'} | Pages: ${session?.pagesProcessed || 1} | Orders queued: ${session?.orders?.length || 0} | Records: ${session?.records?.length || 0}`);
    }
    if (!session || session.phase !== 'completed') throw Error(session?.error || 'Transactions extraction did not complete');
    const result = await exportCompleted();
    if (!result?.ok) throw Error(result?.error || 'Transactions export failed');
    status({ ...buildRunLog(session, 'completed'), saved: true });
  } catch (error) {
    status('ERROR: ' + error.message);
    if (options.keepRunning) throw error;
  } finally {
    if (!options.keepRunning) setRunning(false);
  }
}

async function getGiftCardTransactions(options = {}) {
  try {
    setRunning(true);
    await saveConfig();
    await send({
      type: 'START_GIFT_CARD_EXTRACTION',
      start: $('start').value,
      end: $('end').value,
      csvFilename: $('giftCardCsv').value || 'amazon-gift-card-transactions.csv',
      logFilename: $('giftCardLog').value || 'amazon-gift-card-transactions-run-log.json',
      maxPages: Number($('giftCardMaxPages').value) || 120,
      hardDateLimitYears: Number($('giftCardHardYears').value) || 1
    }, 'gift-card');
    let session;
    for (;;) {
      await sleep(1000);
      session = (await chrome.storage.local.get('amazonGiftCardSession')).amazonGiftCardSession;
      if (!session) throw Error('Gift Card extraction session is missing');
      if (['completed', 'failed', 'stopped'].includes(session?.phase)) break;
      status(`Gift Card phase: ${session?.phase || 'starting'} | Pages: ${session?.pagesProcessed || 1} | Records: ${session?.records?.length || 0}`);
    }
    if (!session || session.phase !== 'completed') throw Error(session?.error || 'Gift Card extraction did not complete');
    const result = await exportGiftCardCompleted();
    if (!result?.ok) throw Error(result?.error || 'Gift Card export failed');
    status({ ...buildGiftCardRunLog(session, 'completed'), saved: true });
  } catch (error) {
    status('ERROR: ' + error.message);
    if (options.keepRunning) throw error;
  } finally {
    if (!options.keepRunning) setRunning(false);
  }
}

async function getAll() {
  try {
    setRunning(true);
    status('Get All: starting Gift Card transactions.');
    await getGiftCardTransactions({ keepRunning: true });
    status('Get All: Gift Card transactions saved. Starting transactions.');
    await getTransactions({ keepRunning: true });
  } catch (error) {
    status('ERROR: ' + error.message);
  } finally {
    setRunning(false);
  }
}

$('allRun').onclick = getAll;
$('giftCardRun').onclick = getGiftCardTransactions;
$('run').onclick = getTransactions;
$('stop').onclick = async () => {
  const { amazonSession = {}, amazonGiftCardSession = {} } = await chrome.storage.local.get(['amazonSession', 'amazonGiftCardSession']);
  await chrome.storage.local.set({
    amazonSession: { ...amazonSession, phase: 'stopped' },
    amazonGiftCardSession: { ...amazonGiftCardSession, phase: 'stopped' }
  });
  $('stop').disabled = true;
  status('Stopped');
};

chrome.storage.local.get(['amazonSession', 'amazonGiftCardSession']).then(({ amazonSession, amazonGiftCardSession }) => {
  const orderRunning = amazonSession && !['completed', 'failed', 'stopped'].includes(amazonSession.phase);
  const giftCardRunning = amazonGiftCardSession && !['completed', 'failed', 'stopped'].includes(amazonGiftCardSession.phase);
  setRunning(Boolean(orderRunning || giftCardRunning));
});

loadConfig().catch(error => status('ERROR: ' + error.message));
