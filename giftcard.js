(() => {
  if (globalThis.amazonGiftCardExtractorLoaded) return;
  globalThis.amazonGiftCardExtractorLoaded = true;

  let runId = null;
  const tabId = chrome.runtime.sendMessage({ type: 'EXTRACTOR_TAB_ID' }).then(r => r.tabId);
  const version = chrome.runtime.getManifest().version;
  const text = element => (element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const DEFAULT_MAX_PAGES = 120;
  const DEFAULT_HARD_DATE_YEARS = 1;

  const dateOf = value => {
    const match = String(value).match(/(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/i);
    if (!match) return '';
    const date = new Date(match[0]);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  };

  const hardStartDate = years => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - (Number(years) || DEFAULT_HARD_DATE_YEARS));
    return date.toISOString().slice(0, 10);
  };

  const save = async patch => {
    const { amazonGiftCardSession = {} } = await chrome.storage.local.get('amazonGiftCardSession');
    if (amazonGiftCardSession.runId !== runId || ['stopped', 'failed', 'completed'].includes(amazonGiftCardSession.phase)) return;
    await chrome.storage.local.set({ amazonGiftCardSession: { ...amazonGiftCardSession, ...patch } });
  };

  const stopped = async () => {
    const { amazonGiftCardSession: session } = await chrome.storage.local.get('amazonGiftCardSession');
    return !session || session.runId !== runId || ['stopped', 'failed', 'completed'].includes(session.phase);
  };

  const hash = value => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index++) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
  };

  function nextPageControl() {
    const controls = 'button,a,input,[role="button"]';
    for (const element of document.querySelectorAll(controls + ',span')) {
      const labels = [text(element), element.value || '', element.getAttribute('aria-label') || '', element.getAttribute('title') || ''];
      if (!labels.some(label => /^\s*Next(?:\s+Page)?\s*$/i.test(label)) &&
          !/(?:^|:)NextPage$/i.test(element.getAttribute('name') || '')) continue;
      const control = element.matches(controls) ? element :
        element.closest('.a-button')?.querySelector('input,button,a') || element.closest(controls) || element;
      if (!control.disabled && control.getAttribute('aria-disabled') !== 'true' &&
          !control.closest('.a-button-disabled,[aria-disabled="true"]')) return control;
    }
    return null;
  }

  function pageSignature() {
    return [...document.querySelectorAll('tr,li,.a-row')]
      .map(row => text(row))
      .filter(value => /\$\s*[\d,]+\.\d{2}/.test(value) && dateOf(value))
      .join('|')
      .slice(0, 4000);
  }

  async function waitForStableRows() {
    let previous = '';
    let stableCount = 0;
    for (let wait = 0; wait < 20; wait++) {
      await sleep(250);
      const current = candidateRows().map(row => text(row)).join('|');
      if (current && current === previous) stableCount++;
      else stableCount = 0;
      previous = current;
      if (stableCount >= 2) return;
    }
  }

  function descriptionOf(row, cells) {
    const preferred = cells[1] ? text(cells[1]) : '';
    const value = preferred || text(row);
    return value
      .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i, '')
      .replace(/[+-]?\s*\$\s*[\d,]+\.\d{2}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function transactionTypeOf(description, rowText) {
    const value = `${description} ${rowText}`;
    if (/refund/i.test(value)) return 'Refund';
    if (/redeem|redemption|order|purchase|appl(?:ied|y)/i.test(value)) return 'Charge';
    if (/reload|added|claim|promotion|promotional|credit|adjustment/i.test(value)) return 'Credit';
    return description || 'Gift Card Activity';
  }

  function visibleAmountOf(value) {
    const matches = [...String(value).matchAll(/([+-])?\s*\$\s*([\d,]+\.\d{2})/g)];
    if (!matches.length) return null;
    const match = matches[0];
    return { sign: match[1] || '', numeric: Number(match[2].replace(/,/g, '')), raw: match[0].replace(/\s+/g, '') };
  }

  function normalizedAmount(amount, transactionType) {
    if (!amount) return '';
    if (/^Refund$/i.test(transactionType)) return -amount.numeric;
    if (/^Charge$/i.test(transactionType)) return amount.numeric;
    if (amount.sign === '-') return amount.numeric;
    if (amount.sign === '+') return -amount.numeric;
    return amount.numeric;
  }

  function debugIdOf(row, description, date, amount) {
    const link = [...row.querySelectorAll('a[href]')].find(anchor => /orderID=|order-details|gift/i.test(anchor.href));
    const orderId = link?.href.match(/[?&]orderID=([^&]+)/i)?.[1];
    const dataId = [...row.attributes || []].find(attribute => /(?:id|transaction|activity)/i.test(attribute.name) && attribute.value)?.value || '';
    if (orderId) return decodeURIComponent(orderId);
    if (dataId) return dataId;
    return `row-${hash([date, description, amount?.raw || '', text(row)].join('|'))}`;
  }

  function giftCardActivityTable() {
    return [...document.querySelectorAll('table')].find(table => /Date\s+Description\s+Amount\s+Closing balance/i.test(text(table))) || null;
  }

  function hasGiftCardActivityTable() {
    return Boolean(giftCardActivityTable()) || /Gift Card Activity/i.test(text(document.querySelector('h1')));
  }

  function candidateRows() {
    const table = giftCardActivityTable();
    if (table) {
      return [...table.querySelectorAll('tr')].filter(row => {
        const cells = [...row.querySelectorAll('td')];
        return cells.length >= 3 && dateOf(text(cells[0])) && /[+-]?\s*\$\s*[\d,]+\.\d{2}/.test(text(cells[2]));
      });
    }
    return [...document.querySelectorAll('tr')].filter(row => {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length < 3) return false;
      return dateOf(text(cells[0])) && /[+-]?\s*\$\s*[\d,]+\.\d{2}/.test(text(cells[2])) && !/^Date\s+.*Amount/i.test(text(row));
    });
  }

  function extractRows(session) {
    const rows = [];
    const seen = new Set(session.seenKeys || []);
    for (const row of candidateRows()) {
      const cells = [...row.querySelectorAll('td,th')];
      const rowText = text(row);
      const date = dateOf(cells[0] ? text(cells[0]) : rowText);
      if (!date || date < session.effectiveStart || date > session.end) continue;
      const amount = visibleAmountOf(cells.length >= 3 ? text(cells[2]) : rowText);
      if (!amount) continue;
      const description = descriptionOf(row, cells);
      const transactionType = transactionTypeOf(description, rowText);
      const debugId = debugIdOf(row, description, date, amount);
      const normalized = normalizedAmount(amount, transactionType);
      const sourceFingerprint = hash([date, description, transactionType, amount.raw, debugId, rowText].join('|'));
      const key = `${debugId}|${sourceFingerprint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        Date: date,
        Amount: normalized,
        'Transaction type': transactionType,
        Description: description,
        'Debug transaction ID': debugId,
        'Source fingerprint': sourceFingerprint,
        'Visible amount': amount.raw,
        'Amazon Verify': date && amount.raw && transactionType && description ? 'VERIFIED' : 'NOT VERIFIED',
        'MD Import': '',
        'MD Verify': '',
        'MD Failure reason': ''
      });
    }
    return { rows, seenKeys: [...seen] };
  }

  async function collect(session) {
    if (await stopped()) return;
    const { rows, seenKeys } = extractRows(session);
    const records = [...(session.records || []), ...rows];
    const pageDates = candidateRows().map(row => dateOf(text(row))).filter(Boolean);
    const reachedStart = pageDates.some(date => date < session.effectiveStart);
    const pagesProcessed = session.pagesProcessed || 1;
    const next = !reachedStart && pagesProcessed < session.maxPages ? nextPageControl() : null;
    await save({
      phase: next ? 'gift-card-list' : 'completed',
      records,
      seenKeys,
      pagesProcessed,
      transactionsFound: records.length,
      paginationDiagnostic: {
        url: location.href,
        nextFound: Boolean(next),
        reachedStart,
        maxPagesReached: pagesProcessed >= session.maxPages,
        rowsOnPage: rows.length,
        oldestDateOnPage: pageDates.sort()[0] || ''
      }
    });
    if (!next) return;
    if (await stopped()) return;
    const before = pageSignature();
    const nextSession = { ...session, records, seenKeys, pagesProcessed: pagesProcessed + 1 };
    await save({
      phase: 'gift-card-list',
      records,
      seenKeys,
      pageSignature: before,
      pagesProcessed: nextSession.pagesProcessed,
      paginationDiagnostic: {
        url: location.href,
        nextFound: true,
        reachedStart,
        maxPagesReached: false,
        rowsOnPage: rows.length,
        oldestDateOnPage: pageDates.sort()[0] || '',
        nextClickPending: true
      }
    });
    next.click();
    for (let wait = 0; wait < 20; wait++) {
      await sleep(500);
      if (await stopped()) return;
      if (pageSignature() !== before) break;
    }
    if (pageSignature() === before) {
      await save({ phase: 'failed', error: 'Gift Card pagination content unchanged after 10 seconds' });
      return;
    }
    await waitForStableRows();
    await save({ phase: 'gift-card-list', pageSignature: pageSignature(), pagesProcessed: nextSession.pagesProcessed });
    await collect(nextSession);
  }

  chrome.storage.local.get('amazonGiftCardSession').then(async ({ amazonGiftCardSession: session }) => {
    if (!session || session.extensionVersion !== version || session.ownerTab !== await tabId ||
        ['completed', 'failed', 'stopped'].includes(session.phase)) return;
    runId = session.runId;
    if (session.phase === 'gift-card-list' && hasGiftCardActivityTable()) await collect(session);
  }).catch(error => save({ phase: 'failed', error: error.message }));

  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message.type !== 'START_GIFT_CARD_EXTRACTION') return;
    (async () => {
      runId = crypto.randomUUID();
      const configuredStart = message.start;
      const hardStart = hardStartDate(message.hardDateLimitYears);
      const effectiveStart = configuredStart > hardStart ? configuredStart : hardStart;
      const session = {
        start: configuredStart,
        effectiveStart,
        end: message.end,
        runId,
        ownerTab: await tabId,
        extensionVersion: version,
        phase: 'gift-card-list',
        records: [],
        seenKeys: [],
        pagesProcessed: 1,
        maxPages: Number(message.maxPages) || DEFAULT_MAX_PAGES,
        hardDateLimitYears: Number(message.hardDateLimitYears) || DEFAULT_HARD_DATE_YEARS,
        csvFilename: message.csvFilename || 'amazon-gift-card-transactions.csv',
        logFilename: message.logFilename || 'amazon-gift-card-transactions-run-log.json',
        startedAt: new Date().toISOString()
      };
      await chrome.storage.local.set({ amazonGiftCardSession: session });
      reply({ ok: true });
      const giftCardStartUrl = 'https://www.amazon.com/gc/balance';
      if (!hasGiftCardActivityTable() || location.search.includes('next=')) {
        location.href = giftCardStartUrl;
        return;
      }
      await collect(session);
    })().catch(error => { reply({ ok: false, error: error.message }); return save({ phase: 'failed', error: error.message }); });
    return true;
  });
})();



