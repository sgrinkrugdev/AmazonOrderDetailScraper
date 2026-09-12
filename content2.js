(() => {
  if (globalThis.amazonExtractorLoaded) return;
  globalThis.amazonExtractorLoaded = true;
  let runId = null;
  const tabId = chrome.runtime.sendMessage({ type: 'EXTRACTOR_TAB_ID' }).then(r => r.tabId);
  const version = chrome.runtime.getManifest().version;
  const text = e => (e?.innerText || e?.textContent || e?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
  const dateOf = value => { const ms = String(value).match(/(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/ig); const raw = ms?.at(-1); if (!raw) return ''; const d = new Date(raw); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };
  const save = async patch => { const { amazonSession = {} } = await chrome.storage.local.get('amazonSession'); if (amazonSession.runId !== runId || ['stopped','failed','completed'].includes(amazonSession.phase)) return; await chrome.storage.local.set({ amazonSession: { ...amazonSession, ...patch } }); };
  // Dates head groups of transactions, rather than appearing inside each row.
  // End the range at this order link so later groups cannot supply its date.
  const transactionDateOf = link => {
    const range = document.createRange();
    range.setStart(document.body, 0);
    range.setEndBefore(link);
    return dateOf(range.toString());
  };
  const signature = () => [...document.querySelectorAll('a')].filter(a => /Order\s*#/i.test(text(a))).map(text).join('|');
  function nextPageControl() {
    // Amazon may render the label in a span beside an unlabeled input.
    const controls = 'button,a,input,[role="button"]';
    for (const el of document.querySelectorAll(controls + ',span')) {
      const labels = [text(el), el.value || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || ''];
      if (!labels.some(label => /^\s*Next(?:\s+Page)?\s*$/i.test(label)) &&
          !/(?:^|:)NextPage$/i.test(el.getAttribute('name') || '')) continue;
      const control = el.matches(controls) ? el :
        el.closest('.a-button')?.querySelector('input,button,a') || el.closest(controls) || el;
      if (!control.disabled && control.getAttribute('aria-disabled') !== 'true' &&
          !control.closest('.a-button-disabled,[aria-disabled="true"]')) return control;
    }
    return null;
  }
  const orderNumber = value => (String(value).match(/Order\s*#\s*([A-Z0-9-]+)/i) || [,''])[1];
  const cardOf = value => { const m=String(value).match(/(?:Amazon\s+)?(?:Visa|Mastercard|American Express|Discover)\s*(?:\*{0,4}|ending\s+in\s*)(\d{4})/i); if(m) return m[0].replace(/\s+/g,' ').trim(); const gift=String(value).match(/Amazon\s+Gift\s+Card/i); return gift ? gift[0] : ''; };

  const stopped = async () => { const {amazonSession:s} = await chrome.storage.local.get('amazonSession'); return !s || s.runId !== runId || ['stopped','failed','completed'].includes(s.phase); };

  function digitalPayment(link, date) {
    const range = document.createRange();
    range.setStart(document.body, 0);
    range.setEndBefore(link);
    const prefix = range.toString().replace(/\s+/g, ' ').trim();
    // The transaction row can render the order link before its card/amount
    // text (especially Amazon Digital). Inspect both sides of the link and
    // keep only the nearest payment tuple.
    const suffixRange = document.createRange();
    suffixRange.setStartAfter(link);
    suffixRange.setEnd(document.body, document.body.childNodes.length);
    const suffix = suffixRange.toString().replace(/\s+/g, ' ').trim();
    const payment = /((?:(?:Prime|Amazon)\s+)?(?:Visa|Mastercard|American Express|Discover)\s+(?:\*{4}|ending\s+in\s+)\d{4}|Amazon Gift Card)\s+([+-])\s*\$\s*([\d,]+\.\d{2})/i;
    const beforeMatches = [...prefix.matchAll(new RegExp(payment.source, 'ig'))];
    const m = beforeMatches.at(-1) || suffix.match(payment);
    if (!m || !date) return null;
    const refund = /^Refund:/i.test(text(link));
    if (!refund && m[2] !== '-') return null;
    return { 'Credit card': m[1], Date: date, 'Date source': 'Amazon Payments transaction date',
      'Order amount': (refund ? -1 : 1) * Number(m[3].replace(/,/g, '')),
      'Transaction type': refund ? 'Refund' : 'Charge' };
  }

  async function collect(s) {
    if (await stopped()) return;
    const found = [];
    for (const link of [...document.querySelectorAll('a')].filter(a => /Order\s*#/i.test(text(a)))) {
      const order = orderNumber(text(link)), d = transactionDateOf(link);
      if (order && (!d || (d >= s.start && d <= s.end))) found.push({ order, date: d, digitalPayments: /^D\d+-/.test(order) ? [digitalPayment(link, d)].filter(Boolean) : [], url: /^https:\/\/(?:www\.)?(?:amazon\.com|payments\.amazon\.com)\//i.test(link.href) ? link.href : '', linkError: link.href ? '' : 'Invalid or missing order-details link' });
    }
    const direct = [];
    const body = text(document.body);
    // Keep card, amount, order and merchant adjacent: never span another payment.
    const wholeFoods = /((?:(?:Prime|Amazon)\s+)?(?:Visa|Mastercard|American Express|Discover)\s+(?:\*{4}|ending\s+in\s+)\d{4}|Amazon Gift Card)\s+([+-])\s*\$\s*([\d,]+\.\d{2})\s+(Refund:\s*)?Order\s*#\s*([A-Z0-9-]+)\s+Whole\s+Foods\b/ig;
    let match;
    while ((match = wholeFoods.exec(body))) {
      const date = dateOf(body.slice(0, match.index));
      if (!date || date < s.start || date > s.end) continue;
      const refund = Boolean(match[4]);
      if (!refund && match[2] !== '-') continue;
      direct.push({ 'Credit card': match[1], 'Order number': match[5],
        Date: date, 'Date source': 'Amazon transaction list date',
        'Order amount': (refund ? -1 : 1) * Number(match[3].replace(/,/g, '')),
        'Item description': 'Whole Foods', 'Transaction type': refund ? 'Refund' : 'Charge',
        'Order details URL': '', 'Retrieval Result': 'Transaction list extracted', Notes: '' });
    }
    const records = [...(s.records || []), ...direct];
    // A detail visit retrieves all transactions for the order, across dates.
    // Deduplicate visits, not payment rows: identical payments may be legitimate.
    const orderMap = new Map();
    for (const item of [...(s.orders || []), ...found]) {
      const previous = orderMap.get(item.order);
      orderMap.set(item.order, {...item, digitalPayments: [...(previous?.digitalPayments || []), ...(item.digitalPayments || [])]});
    }
    const orders = [...orderMap.values()];
    // Finish the entire boundary page, including every transaction on the start date.
    const pageDates = [...document.querySelectorAll('a')].filter(a => /Order\s*#/i.test(text(a))).map(transactionDateOf).filter(Boolean);
    const reachedStart = pageDates.some(date => date < s.start);
    const next = reachedStart ? null : nextPageControl();
    await save({ paginationDiagnostic: { url: location.href, nextFound: Boolean(next),
      nextTag: next?.tagName || '', nextName: next?.getAttribute('name') || '',
      orderLinks: document.querySelectorAll('a[href*="order"]').length } });
    if (next && !next.disabled && next.getAttribute('aria-disabled') !== 'true') {
      const before = signature(); await save({ phase: 'list', orders, records, pagesProcessed: s.pagesProcessed || 1, pageSignature: before, paginationVerified: false }); if (await stopped()) return; next.click();
      for (let wait = 0; wait < 20; wait++) { await new Promise(resolve => setTimeout(resolve, 500)); if (await stopped()) return; if (signature() !== before) break; }
      const after = signature();
      if (after === before) { await save({ phase: 'failed', pageSignature: after, pagesProcessed: (s.pagesProcessed || 1) + 1, error: 'Pagination content unchanged after 10 seconds' }); return; }
      const nextState = { ...s, orders, records, phase: 'list', pageSignature: after, pagesProcessed: (s.pagesProcessed || 1) + 1 }; await save(nextState); await collect(nextState); return;
    }
    if (direct.length && !orders.length) return save({ phase: 'completed', orders: [], index: 0, records, pagesProcessed: s.pagesProcessed || 1, transactionsFound: direct.length, paginationVerified: true });
    await save({ phase: 'opening-order-details', orders, index: 0, records, pagesProcessed: s.pagesProcessed || 1, transactionsFound: orders.length + direct.length, paginationVerified: true });
    if (await stopped()) return;
    if (orders[0]?.url) location.href = orders[0].url; else if (orders[0]) await advance(s, [], orders[0].linkError); else await save({ phase: 'completed' });
  }

  async function detail(s) {
    if (await stopped()) return;
    if (location.hostname === 'payments.amazon.com') return extractAmazonPay(s);
    if (/^D\d+-/.test(s.orders[s.index].order)) {
      const order = s.orders[s.index];
      if (!text(document.body).includes(order.order)) return advance(s, [], 'Digital order identity not found');
      const titles = [...document.querySelectorAll('a[href*="/dp/"],a[href*="/gp/product/"]')]
        .filter(el => !el.closest('#navbar,#navFooter,#ewc-content'))
        .map(text).filter(value => value.length > 3);
      const description = [...new Set(titles.map(normalizeDescription))].join('; ');
      let digitalPayments = order.digitalPayments || [];
      if (!digitalPayments.length) {
        const body = text(document.body);
        const cardMatch = body.match(/Payment method\s+(?:(?:Amazon\s+)?(?:Visa|Mastercard|American Express|Discover)\s*(?:\*{4}|ending\s+in\s*)\d{4}|Amazon Gift Card)/i);
        const totalMatch = body.match(/Total for this Order:\s*\$\s*([\d,]+\.\d{2})/i);
        if (cardMatch && totalMatch) digitalPayments = [{
          'Credit card': cardMatch[0].replace(/^Payment method\s+/i, '').replace(/\s+/g, ' ').trim(),
          Date: order.date, 'Date source': 'Amazon order date (digital fallback)',
          'Order amount': Number(totalMatch[1].replace(/,/g, '')), 'Transaction type': 'Charge'
        }];
      }
      if (!digitalPayments.length) return advance(s, [], 'Digital payment not found on transaction or order page');
      return advance(s, digitalPayments.map(payment => ({...payment,
        'Order number': order.order, 'Order details URL': location.href,
        'Item description': description, Notes: description ? '' : 'Digital product title not found' })), '');
    }
    if (/transactionTag=|Transactions from Order/i.test(location.href + ' ' + text(document.body))) return extract(s);
    const items = [...document.querySelectorAll('.orderDetails a[href*="/dp/"],#orderDetails a[href*="/dp/"],.orderDetails a[href*="/gp/product/"],#orderDetails a[href*="/gp/product/"]')].map(text).filter(x => x.length > 3);
    const button = [...document.querySelectorAll('a,button')].find(e => /View related transactions/i.test(text(e)));
    if (!button) return advance(s, [], 'View related transactions control not found');
    const itemDescription = [...new Set(items.map(normalizeDescription).filter(Boolean))].join('; ');
    await save({ phase: 'opening-related-transactions', itemDescription }); if (await stopped()) return; button.click(); setTimeout(() => extract({ ...s, itemDescription }), 1500);
  }

  async function extractAmazonPay(s) {
    if (await stopped()) return;
    const rows = [];
    const merchant = text(document.querySelector('h1')).replace(/^Your\s+/i, '').replace(/\s+purchase details$/i, '');
    const payment = text(document.body).match(/(?:MasterCard|Visa|American Express|Discover)\s+ending in\s+\d{4}/i)?.[0] || '';
    for (const table of document.querySelectorAll('table')) {
      if (!/Date\s+Amount\s+Transaction type\s+Payment method/i.test(text(table))) continue;
      for (const row of table.querySelectorAll('tr')) {
        const cells = [...row.querySelectorAll('td')].map(text);
        if (cells.length < 4 || !/^(Charge|Refund)$/i.test(cells[2])) continue;
        const date = dateOf(cells[0]);
        if (!date || date < s.start || date > s.end) continue;
        const amount = cells[1].match(/\$\s*([\d,]+\.\d{2})/);
        if (!amount) continue;
        const suffix = cells[3].match(/\d{4}/)?.[0];
        const card = suffix && payment.endsWith(suffix) ? payment : cells[3];
        const type = /^Refund$/i.test(cells[2]) ? 'Refund' : 'Charge';
        rows.push({ 'Credit card': card, 'Order number': s.orders[s.index].order,
          Date: date, 'Date source': 'Amazon Pay transaction history',
          'Order amount': (type === 'Refund' ? -1 : 1) * Number(amount[1].replace(/,/g, '')),
          'Item description': merchant, 'Transaction type': type, 'Order details URL': location.href,
          Notes: merchant && payment.endsWith(suffix || 'NO CARD') ? '' : 'Merchant or full payment card unavailable' });
      }
    }
    await advance(s, rows, rows.length ? '' : 'Amazon Pay completed transaction history not found');
  }

  async function extract(s) {
    if (await stopped()) return;
    const rows = [], seen = new Set(), root = document.body;
    for (const link of [...root.querySelectorAll('a')].filter(a => /Order\s*#/i.test(text(a)))) {
      let node = link, transactionDate = transactionDateOf(link);
      if (transactionDate && (transactionDate < s.start || transactionDate > s.end)) continue;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const value = text(node), amounts = value.match(/[+-]\s*\$\s*[\d,]+\.\d{2}/g) || [];
        if (value.length > 500 || amounts.length !== 1) continue;
        const amount = value.match(/([+-])\s*\$\s*([\d,]+\.\d{2})/), key = `${link.id}|${amount[0]}`; if (seen.has(key)) break; seen.add(key);
        const card = cardOf(value);
        // Completed purchase rows use "Order #" rather than a "Charge" label.
        // Require both that purchase label and a debit; a sign alone is insufficient.
        const type = /\bRefund\b/i.test(value) ? 'Refund' : /\bCharge\b/i.test(value) ? 'Charge' :
          !/\b(?:Pending|Authorization|Cancelled|Declined)\b/i.test(value) &&
          /^Order\s*#/i.test(text(link)) && amount[1] === '-' ? 'Charge' : '';
        const numeric = Number(amount[2].replace(/,/g, ''));
        rows.push({ 'Credit card': card, 'Order number': s.orders[s.index].order, Date: transactionDate || s.orders[s.index].date, 'Date source': transactionDate ? 'Amazon related transaction date' : 'Amazon order date fallback', 'Order amount': type === 'Refund' ? -numeric : type === 'Charge' ? numeric : '', 'Item description': s.itemDescription || '', 'Transaction type': type, 'Order details URL': location.href, 'Retrieval Result': 'Related transaction extracted', Notes: [card ? '' : 'Payment method missing', type ? '' : 'Transaction type ambiguous', s.itemDescription ? '' : 'Item mapping failed'].filter(Boolean).join('; ') }); break;
      }
    }
    await advance(s, rows, rows.length ? '' : 'Related transaction rows not found');
  }

  async function advance(s, rows, error) { if (await stopped()) return; const records = [...(s.records || []), ...rows]; if (error) records.push({ 'Credit card': '', 'Order number': s.orders[s.index].order, Date: s.orders[s.index].date, 'Order amount': '', 'Item description': '', 'Transaction type': '', 'Order details URL': s.orders[s.index].url, 'Retrieval Result': 'Failed', Notes: error }); const index = s.index + 1; await save({ phase: index < s.orders.length ? 'opening-order-details' : 'completed', index, records }); if (index < s.orders.length && s.orders[index].url) location.href = s.orders[index].url; else if (index < s.orders.length) advance({ ...s, index, records }, [], s.orders[index].linkError); }

  chrome.storage.local.get('amazonSession').then(async ({ amazonSession: s }) => {
    if (!s || s.extensionVersion !== version || s.ownerTab !== await tabId ||
        ['completed','failed','stopped'].includes(s.phase)) return;
    runId = s.runId;
    if (s.phase === 'list' && /\/cpe\/yourpayments\/transactions/.test(location.pathname) && !location.search.includes('transactionTag')) await collect(s);
    else if (['opening-order-details','opening-related-transactions'].includes(s.phase)) await detail(s);
  }).catch(error => save({phase:'failed',error:error.message}));
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message.type !== 'START_EXTRACTION') return;
    (async () => {
      runId = crypto.randomUUID();
      const s = {start:message.start,end:message.end,runId,ownerTab:await tabId,
        extensionVersion:version,phase:'list',orders:[],records:[],index:0,
        pagesProcessed:0,startedAt:new Date().toISOString()};
      await chrome.storage.local.set({amazonSession:s});
      reply({ok:true});
      if (location.search.includes('transactionTag')) location.href='https://www.amazon.com/cpe/yourpayments/transactions';
      else await collect(s);
    })().catch(error => { reply({ok:false,error:error.message}); return save({phase:'failed',error:error.message}); });
    return true;
  });
})();
