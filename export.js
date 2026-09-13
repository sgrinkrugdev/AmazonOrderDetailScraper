const COLUMNS = ['Credit card','Order number','Date source','Verification','Order amount','Date','MD Verify','MD Match','Item description','MD Failure reason','Transaction type','Order details URL','Overall Result'];
const GIFT_CARD_COLUMNS = ['Date','Amount','Transaction type','Description','Debug transaction ID','Source fingerprint','Visible amount','Amazon Verify','MD Import','MD Verify','MD Failure reason'];

function cell(v) {
  return '"' + String(v ?? '').replaceAll('"', '""') + '"';
}

function cleanCardName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/(Visa|Mastercard|American Express|Discover)\s*ending\s+in\s*/i, '$1 ending in ')
    .trim();
}

function cleanDateSource(value, fallbackDate) {
  return String(value || (fallbackDate ? 'Transaction date' : ''))
    .replace(/\s+/g, ' ')
    .replace('Amazon Pay transaction history', 'Transaction history')
    .replace('Amazon order date (digital fallback)', 'Order date (digital fallback)');
}

function buildExportRows(records) {
  return (records || []).map(r => {
    const reason = r['MD Failure reason'] || r.Notes || '';
    const verified = reason ? 'NOT VERIFIED' : (r.Verification || 'VERIFIED');
    const masterMatch = typeof matchesMaster === 'function' ? matchesMaster(r) : null;
    return {
      'Credit card': cleanCardName(r['Credit card']),
      'Order number': r['Order number'] || '',
      'Date source': cleanDateSource(r['Date source'], r.Date),
      'Verification': verified,
      'Order amount': r['Order amount'] ?? '',
      'Date': r.Date || '',
      'MD Verify': r['MD Verify'] || '',
      'MD Match': r['MD Match'] || '',
      'Item description': r['Item description'] || '',
      'MD Failure reason': reason,
      'Transaction type': r['Transaction type'] || '',
      'Order details URL': /Whole Foods/i.test(r['Item description'] || '') ? '' : (r['Order details URL'] || ''),
      'Overall Result': masterMatch === null ? 'NOT COMPARED (no reference data)' : !masterMatch ? 'MF mismatch' : (reason ? 'MISMATCH' : 'MATCH')
    };
  });
}

function csv(records) {
  const rows = buildExportRows(records);
  return [COLUMNS, ...rows.map(r => COLUMNS.map(x => r[x] ?? ''))].map(r => r.map(cell).join(',')).join('\r\n');
}

function giftCardCsv(records) {
  const rows = (records || []).map(record => ({
    'Date': record.Date || '',
    'Amount': record.Amount ?? '',
    'Transaction type': record['Transaction type'] || '',
    'Description': record.Description || '',
    'Debug transaction ID': record['Debug transaction ID'] || '',
    'Source fingerprint': record['Source fingerprint'] || '',
    'Visible amount': record['Visible amount'] || '',
    'Amazon Verify': record['Amazon Verify'] || '',
    'MD Import': record['MD Import'] || '',
    'MD Verify': record['MD Verify'] || '',
    'MD Failure reason': record['MD Failure reason'] || ''
  }));
  return [GIFT_CARD_COLUMNS, ...rows.map(row => GIFT_CARD_COLUMNS.map(column => row[column] ?? ''))].map(row => row.map(cell).join(',')).join('\r\n');
}

function buildRunLog(session, status, error) {
  const records = session?.records || [];
  const log = {
    extensionVersion: chrome.runtime.getManifest().version,
    start: session?.start,
    end: session?.end,
    skillVersion: '1.2',
    pagesProcessed: session?.pagesProcessed || 1,
    transactionsFound: records.length,
    recordsSaved: status === 'completed' ? records.length : 0,
    errors: records.filter(r => r.Notes).length,
    columns: COLUMNS
  };
  if (status) log.status = status;
  if (session?.paginationDiagnostic) log.paginationDiagnostic = session.paginationDiagnostic;
  if (error) log.error = error;
  return log;
}

function buildGiftCardRunLog(session, status, error) {
  const records = session?.records || [];
  const log = {
    extensionVersion: chrome.runtime.getManifest().version,
    start: session?.start,
    effectiveStart: session?.effectiveStart,
    end: session?.end,
    extractor: 'gift-card-activity',
    pagesProcessed: session?.pagesProcessed || 1,
    maxPages: session?.maxPages,
    hardDateLimitYears: session?.hardDateLimitYears,
    transactionsFound: records.length,
    recordsSaved: status === 'completed' ? records.length : 0,
    amazonVerified: records.filter(record => record['Amazon Verify'] === 'VERIFIED').length,
    columns: GIFT_CARD_COLUMNS
  };
  if (status) log.status = status;
  if (session?.paginationDiagnostic) log.paginationDiagnostic = session.paginationDiagnostic;
  if (error) log.error = error;
  return log;
}
