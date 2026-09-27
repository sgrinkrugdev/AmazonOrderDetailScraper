(() => {
  const version = chrome.runtime.getManifest().version;
  if (globalThis.amazonExtractorLoadedVersion === version) return;
  globalThis.amazonExtractorLoadedVersion = version;
  let runId = null;
  const tabId = chrome.runtime.sendMessage({ type: 'EXTRACTOR_TAB_ID' }).then(r => r.tabId);
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
  const transactionLinks = (root = document) => [...root.querySelectorAll('a')].filter(a => /Order\s*#/i.test(text(a)));
  const signature = () => transactionLinks().map(text).join('|');
  const uniqueElements = values => [...new Set(values.filter(Boolean))];
  function transactionScrollContainers() {
    const all = uniqueElements([document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll('*')]);
    return all.filter(el => {
      if (!el || el.scrollHeight <= el.clientHeight + 20) return false;
      if (el === document.scrollingElement || el === document.documentElement || el === document.body) return true;
      return transactionLinks(el).length > 0 || /Order\s*#/.test(text(el));
    }).sort((a, b) => {
      const rows = transactionLinks(b).length - transactionLinks(a).length;
      if (rows) return rows;
      return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
    });
  }
  function scrollTransactionContainers(toTop = false) {
    let moved = false;
    const containers = transactionScrollContainers();
    for (const el of containers) {
      try {
        const before = el.scrollTop;
        if (toTop) el.scrollTop = 0;
        else el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + Math.max(700, Math.floor((el.clientHeight || window.innerHeight) * 0.85)));
        if (el.scrollTop !== before) moved = true;
      } catch (_) {}
    }
    if (toTop) window.scrollTo(0, 0);
    else window.scrollBy(0, Math.max(700, Math.floor(window.innerHeight * 0.85)));
    return { moved, containers: containers.map(el => ({ tag: el.tagName, id: el.id || '', className: String(el.className || '').slice(0, 80), scrollTop: Math.round(el.scrollTop || 0), clientHeight: Math.round(el.clientHeight || 0), scrollHeight: Math.round(el.scrollHeight || 0), rows: transactionLinks(el).length })).slice(0, 5) };
  }
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
  const orderDetailsUrl = order => `https://www.amazon.com/gp/css/summary/edit.html?orderID=${encodeURIComponent(order)}`;
  function transactionFromText(value, href = '') {
    const order = orderNumber(value);
    if (!order) return null;
    const date = dateOf(value);
    const amount = String(value || '').match(/([+-])\s*\$\s*([\d,]+\.\d{2})/);
    const status = String(value || '').match(/\b(Charged|Refunded|Charge|Refund)\b/i)?.[1] || '';
    const type = /^Refund/i.test(status) ? 'Refund' : /^Charg/i.test(status) ? 'Charge' : '';
    const realHref = /^https:\/\/(?:www\.)?(?:amazon\.com|payments\.amazon\.com)\//i.test(href) && !/\/cpe\/yourpayments\/transactions#?$/i.test(href) ? href : '';
    return { order, date, amount, type, card: cardOf(value), url: realHref || orderDetailsUrl(order), text: value };
  }
  function listRowTransaction(link) {
    return transactionFromText(text(link), link?.href || '');
  }
  const isStandardOrderId = order => /^\d{3}-\d{7}-\d{7}$/.test(String(order || ''));
  const isDigitalOrderId = order => /^D\d+-/.test(String(order || ''));
  const shouldOpenOrderDetails = order => isStandardOrderId(order) || isDigitalOrderId(order);
  function merchantOf(value) {
    const source = String(value || '').replace(/\s+/g, ' ').trim();
    if (/Whole\s+Foods/i.test(source)) return 'Whole Foods';
    if (/pay\.amazon\.com/i.test(source)) return 'Amazon Pay';
    return '';
  }
  function recordFromListRow(row, notes = '') {
    if (!row?.order || !row.date || !row.amount || !row.type) return null;
    const merchant = merchantOf(row.text);
    const numeric = Number(row.amount[2].replace(/,/g, ''));
    return {
      'Credit card': row.card || '',
      'Order number': row.order,
      Date: row.date,
      'Date source': 'Transaction date',
      Verification: notes ? 'NOT VERIFIED' : 'VERIFIED',
      'Order amount': row.type === 'Refund' ? -numeric : numeric,
      'Item description': merchant,
      'Literal Description': merchant,
      'LD Verified': merchant ? 'VERIFIED' : 'NOT VERIFIED',
      'Transaction type': row.type,
      'Order details URL': merchant === 'Whole Foods' || merchant === 'Amazon Pay' ? '' : row.url,
      'Retrieval Result': notes ? 'Transaction list fallback' : 'Transaction list extracted',
      Notes: notes
    };
  }
  const noisyTitle = value => /\b(?:out of 5 stars|FREE delivery|Two-Day|Tomorrow|\$\s*\d|Currently unavailable|sponsored|Shop now|Add to Cart)\b/i.test(value);
  const trustedTitleRoot = () => document.querySelector('.orderDetails,#orderDetails,[data-test-id="order-details"],[class*="order-details"]') || document.body;
  const trustedProductTitles = (root = trustedTitleRoot()) => {
    const blocked = '#navbar,#navFooter,#ewc-content,#rhf,[id*="sims"],[id*="carousel"],[class*="carousel"],[data-component-type="s-search-result"],[aria-label*="Sponsored"]';
    const links = [...root.querySelectorAll('a[href*="/dp/"],a[href*="/gp/product/"]')]
      .filter(element => !element.closest(blocked))
      .map(text)
      .map(value => value.replace(/\s+/g, ' ').trim())
      .filter(value => value.length > 3 && value.length < 260 && !noisyTitle(value));
    return [...new Set(links)];
  };
  const literalDescriptionOf = titles => [...new Set((titles || []).map(value => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].join('; ');
  const normalizedDescriptionOf = titles => literalDescriptionOf(titles.map(normalizeDescription).filter(Boolean));
  const cardOf = value => {
    const source = String(value || '');
    const gift = source.match(/Amazon\s+Gift\s+Card/i);
    if (gift) return gift[0];
    const m = source.match(/((?:Prime\s+Visa|Amazon\s+Visa|Visa(?:\s+Signature)?|Master[Cc]ard|Capital One\s+Master[Cc]ard|American Express|Discover|Blue Cash|United Explorer|Chase Debit Card)\s*(?:\*{0,4}|•{0,4}|ending\s+in\s*)\d{4})/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  };

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
    const payment = /((?:(?:Prime|Amazon)\s+)?(?:Prime\s+Visa|Amazon\s+Visa|Visa|Master[Cc]ard|American Express|Discover|Blue Cash)\s+(?:\*{4}|•{4}|ending\s+in\s+)\d{4}|Amazon Gift Card)\s+([+-])\s*\$\s*([\d,]+\.\d{2})/i;
    const beforeMatches = [...prefix.matchAll(new RegExp(payment.source, 'ig'))];
    const m = beforeMatches.at(-1) || suffix.match(payment);
    if (!m || !date) return null;
    const refund = /^Refund:/i.test(text(link));
    if (!refund && m[2] !== '-') return null;
    return { 'Credit card': m[1], Date: date, 'Date source': 'Amazon Payments transaction date',
      'Order amount': (refund ? -1 : 1) * Number(m[3].replace(/,/g, '')),
      'Transaction type': refund ? 'Refund' : 'Charge' };
  }

  async function loadTransactionRowsThroughStart(s) {
    const seen = new Map();
    const capture = () => {
      for (const link of transactionLinks()) {
        const rowText = text(link);
        const row = transactionFromText(rowText, link.href || '');
        if (!row?.order || !row.date) continue;
        const amountText = row.amount?.[0] || '';
        const key = [row.date, row.order, amountText, row.type, row.card].join('|');
        seen.set(key, { text: rowText, href: link.href || '' });
      }
    };
    scrollTransactionContainers(true);
    await new Promise(resolve => setTimeout(resolve, 900));
    let stable = 0;
    let lastSeenCount = 0;
    let lastVisibleSignature = '';
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await stopped()) return { stopped: true };
      capture();
      const visibleLinks = transactionLinks();
      const visibleDates = visibleLinks.map(link => listRowTransaction(link)?.date || transactionDateOf(link)).filter(Boolean);
      const allRows = [...seen.values()].map(item => transactionFromText(item.text, item.href)).filter(Boolean);
      const allDates = allRows.map(row => row.date).filter(Boolean).sort();
      const reachedStart = allDates.some(date => date < s.start);
      const visibleSignature = signature();
      if (seen.size === lastSeenCount && visibleSignature === lastVisibleSignature) stable++;
      else stable = 0;
      const scrollState = transactionScrollContainers();
      await save({
        phase: 'scrolling-transaction-list',
        pagesProcessed: attempt + 1,
        paginationDiagnostic: {
          mode: 'infinite-scroll',
          capturedRows: seen.size,
          visibleRows: visibleLinks.length,
          reachedStart,
          stableScrolls: stable,
          oldestCapturedDate: allDates[0] || '',
          newestCapturedDate: allDates.at(-1) || '',
          oldestVisibleDate: visibleDates.at(-1) || '',
          newestVisibleDate: visibleDates[0] || '',
          scrollY: Math.round(window.scrollY || 0),
          scrollHeight: Math.round(document.documentElement.scrollHeight || document.body.scrollHeight || 0),
          scrollContainers: scrollState.map(el => ({ tag: el.tagName, id: el.id || '', className: String(el.className || '').slice(0, 80), scrollTop: Math.round(el.scrollTop || 0), clientHeight: Math.round(el.clientHeight || 0), scrollHeight: Math.round(el.scrollHeight || 0), rows: transactionLinks(el).length })).slice(0, 5)
        }
      });
      if (reachedStart || stable >= 5) {
        return { reachedStart, rows: seen.size, scrolls: attempt + 1, transactions: [...seen.values()] };
      }
      lastSeenCount = seen.size;
      lastVisibleSignature = visibleSignature;
      const moved = scrollTransactionContainers(false);
      if (!moved.moved) stable++;
      await new Promise(resolve => setTimeout(resolve, 650));
    }
    return { reachedStart: false, rows: seen.size, scrolls: 120, exhausted: true, transactions: [...seen.values()] };
  }
  async function collect(s) {
    if (await stopped()) return;
    const scrollResult = await loadTransactionRowsThroughStart(s);
    if (scrollResult?.stopped) return;
    await save({ phase: 'list', infiniteScroll: scrollResult });
    const sourceRows = scrollResult?.transactions?.length ? scrollResult.transactions : transactionLinks().map(link => ({ text: text(link), href: link.href || '' }));
    const found = [];
    const direct = [];
    for (const sourceRow of sourceRows) {
      const row = transactionFromText(sourceRow.text, sourceRow.href || '');
      const order = row?.order;
      const d = row?.date;
      if (!order || (d && (d < s.start || d > s.end))) continue;
      const listRecord = recordFromListRow(row);
      if (!shouldOpenOrderDetails(order)) {
        if (listRecord) direct.push(listRecord);
        continue;
      }
      found.push({
        order,
        date: d,
        digitalPayments: isDigitalOrderId(order) && listRecord ? [{
          'Credit card': listRecord['Credit card'],
          Date: listRecord.Date,
          'Date source': listRecord['Date source'],
          'Order amount': listRecord['Order amount'],
          'Transaction type': listRecord['Transaction type']
        }] : [],
        listRecord,
        url: row?.url || orderDetailsUrl(order),
        linkError: ''
      });
    }
    const body = text(document.body);
    // Keep card, amount, order and merchant adjacent: never span another payment.
    const wholeFoods = /((?:(?:Prime|Amazon)\s+)?(?:Prime\s+Visa|Amazon\s+Visa|Visa|Master[Cc]ard|American Express|Discover|Blue Cash)\s+(?:\*{4}|•{4}|ending\s+in\s+)\d{4}|Amazon Gift Card)\s+([+-])\s*\$\s*([\d,]+\.\d{2})\s+(Refund:\s*)?Order\s*#\s*([A-Z0-9-]+)\s+Whole\s+Foods\b/ig;
    let match;
    while ((match = wholeFoods.exec(body))) {
      const date = dateOf(body.slice(0, match.index));
      if (!date || date < s.start || date > s.end) continue;
      const refund = Boolean(match[4]);
      if (!refund && match[2] !== '-') continue;
      direct.push({ 'Credit card': match[1], 'Order number': match[5],
        Date: date, 'Date source': 'List date',
        'Order amount': (refund ? -1 : 1) * Number(match[3].replace(/,/g, '')),
        'Item description': 'Whole Foods', 'Literal Description': 'Whole Foods', 'LD Verified': 'VERIFIED', 'Transaction type': refund ? 'Refund' : 'Charge',
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
    const pageDates = sourceRows.map(item => transactionFromText(item.text, item.href)?.date).filter(Boolean);
    const reachedStart = pageDates.some(date => date < s.start);
    const next = null;
    await save({ paginationDiagnostic: { ...(s.paginationDiagnostic || {}), ...(scrollResult ? { infiniteScroll: scrollResult } : {}), url: location.href, nextFound: Boolean(next),
      nextTag: next?.tagName || '', nextName: next?.getAttribute('name') || '',
      orderLinks: document.querySelectorAll('a').length, transactionRows: transactionLinks().length, capturedRows: scrollResult?.rows || sourceRows.length } });
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
      const titles = trustedProductTitles();
      const literalDescription = literalDescriptionOf(titles);
      const description = normalizedDescriptionOf(titles);
      const ldVerified = literalDescription ? 'VERIFIED' : 'NOT VERIFIED';
      let digitalPayments = order.digitalPayments || [];
      if (!digitalPayments.length) {
        const body = text(document.body);
        const cardMatch = body.match(/Payment method\s+(?:(?:Amazon\s+)?(?:Prime\s+Visa|Amazon\s+Visa|Visa|Master[Cc]ard|American Express|Discover|Blue Cash)\s*(?:\*{4}|•{4}|ending\s+in\s*)\d{4}|Amazon Gift Card)/i);
        const totalMatch = body.match(/Total for this Order:\s*\$\s*([\d,]+\.\d{2})/i);
        if (cardMatch && totalMatch) digitalPayments = [{
          'Credit card': cardMatch[0].replace(/^Payment method\s+/i, '').replace(/(Visa|Mastercard|American Express|Discover)\s*ending\s+in\s*/i, '$1 ending in ').replace(/\s+/g, ' ').trim(),
          Date: order.date, 'Date source': 'Order date (digital fallback)',
          'Order amount': Number(totalMatch[1].replace(/,/g, '')), 'Transaction type': 'Charge'
        }];
      }
      if (!digitalPayments.length) return advance(s, [], 'Digital payment not found on transaction or order page');
      return advance(s, digitalPayments.map(payment => ({...payment,
        'Order number': order.order, 'Order details URL': location.href,
        'Item description': description, 'Literal Description': literalDescription, 'LD Verified': ldVerified, Notes: description ? '' : 'Digital product title not found' })), '');
    }
    if (/transactionTag=|Transactions from Order/i.test(location.href + ' ' + text(document.body))) return extract(s);
    const items = trustedProductTitles();
    const button = [...document.querySelectorAll('a,button')].find(e => /View related transactions/i.test(text(e)));
    if (!button) return advance(s, [], 'View related transactions control not found');
    const literalDescription = literalDescriptionOf(items);
    const itemDescription = normalizedDescriptionOf(items);
    const ldVerified = literalDescription ? 'VERIFIED' : 'NOT VERIFIED';
    await save({ phase: 'opening-related-transactions', itemDescription, literalDescription, ldVerified }); if (await stopped()) return; button.click(); setTimeout(() => extract({ ...s, itemDescription, literalDescription, ldVerified }), 1500);
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
          Date: date, 'Date source': 'Transaction history',
          'Order amount': (type === 'Refund' ? -1 : 1) * Number(amount[1].replace(/,/g, '')),
          'Item description': merchant, 'Literal Description': merchant, 'LD Verified': merchant ? 'VERIFIED' : 'NOT VERIFIED', 'Transaction type': type, 'Order details URL': location.href,
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
        rows.push({ 'Credit card': card, 'Order number': s.orders[s.index].order, Date: transactionDate || s.orders[s.index].date, 'Date source': transactionDate ? 'Transaction date' : 'Amazon order date fallback', 'Order amount': type === 'Refund' ? -numeric : type === 'Charge' ? numeric : '', 'Item description': s.itemDescription || '', 'Literal Description': s.literalDescription || '', 'LD Verified': s.ldVerified || (s.literalDescription ? 'VERIFIED' : 'NOT VERIFIED'), 'Transaction type': type, 'Order details URL': location.href, 'Retrieval Result': 'Related transaction extracted', Notes: [card ? '' : 'Payment method missing', type ? '' : 'Transaction type ambiguous', s.itemDescription ? '' : 'Item mapping failed'].filter(Boolean).join('; ') }); break;
      }
    }
    await advance(s, rows, rows.length ? '' : 'Related transaction rows not found');
  }

  async function advance(s, rows, error) {
    if (await stopped()) return;
    const order = s.orders[s.index];
    const records = [...(s.records || []), ...rows];
    if (error) {
      const descriptionPatch = s.itemDescription || s.literalDescription ? {
        'Item description': s.itemDescription || s.literalDescription || '',
        'Literal Description': s.literalDescription || s.itemDescription || '',
        'LD Verified': s.literalDescription || s.itemDescription ? 'VERIFIED' : 'NOT VERIFIED'
      } : {};
      const fallback = order?.listRecord ? { ...order.listRecord, ...descriptionPatch, Verification: 'NOT VERIFIED', 'Retrieval Result': 'Transaction list fallback', Notes: error } : null;
      records.push(fallback || { 'Credit card': '', 'Order number': order.order, Date: order.date, 'Order amount': '', 'Item description': descriptionPatch['Item description'] || '', 'Literal Description': descriptionPatch['Literal Description'] || '', 'LD Verified': descriptionPatch['LD Verified'] || 'NOT VERIFIED', 'Transaction type': '', 'Order details URL': order.url, 'Retrieval Result': 'Failed', Notes: error });
    }
    const index = s.index + 1;
    await save({ phase: index < s.orders.length ? 'opening-order-details' : 'completed', index, records });
    if (index < s.orders.length && s.orders[index].url) location.href = s.orders[index].url;
    else if (index < s.orders.length) advance({ ...s, index, records }, [], s.orders[index].linkError);
  }

  chrome.storage.local.get('amazonSession').then(async ({ amazonSession: s }) => {
    if (!s || s.extensionVersion !== version || s.ownerTab !== await tabId ||
        ['completed','failed','stopped'].includes(s.phase)) return;
    runId = s.runId;
    if (s.phase === 'list' && /\/cpe\/yourpayments\/transactions/.test(location.pathname) && !location.search.includes('transactionTag')) await collect(s);
    else if (['opening-order-details','opening-related-transactions'].includes(s.phase)) await detail(s);
  }).catch(error => save({phase:'failed',error:error.message}));
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message.type !== 'START_EXTRACTION_V7') return;
    (async () => {
      runId = crypto.randomUUID();
      const s = {start:message.start,end:message.end,runId,ownerTab:await tabId,
        extensionVersion:version,phase:'list',orders:[],records:[],index:0,
        pagesProcessed:0,startedAt:new Date().toISOString()};
      await chrome.storage.local.set({amazonSession:s});
      reply({ok:true});
      if (!/\/cpe\/yourpayments\/transactions/.test(location.pathname) || location.search.includes('transactionTag')) location.href='https://www.amazon.com/cpe/yourpayments/transactions';
      else await collect(s);
    })().catch(error => { reply({ok:false,error:error.message}); return save({phase:'failed',error:error.message}); });
    return true;
  });
})();










