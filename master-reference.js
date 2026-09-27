// Optional reference rows. Personal transaction records are excluded.
let masterRows = Array.isArray(globalThis.amazonMasterRows) ? globalThis.amazonMasterRows : [];
let masterKeys = buildMasterKeys(masterRows);

function buildMasterKeys(rows) {
  return new Set((rows || []).map(r => masterKey(r.order, r.amount, r.date)).filter(Boolean));
}

function setMasterRows(rows) {
  masterRows = Array.isArray(rows) ? rows : [];
  masterKeys = buildMasterKeys(masterRows);
}

function getMasterRows() {
  return masterRows;
}

function masterKey(order, amount, date) {
  if (!String(amount ?? '').trim() || !Number.isFinite(Number(amount)) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  return [String(order || '').trim(), Math.round(Number(amount) * 100), date].join('|');
}

function matchesMaster(row) {
  if (!masterRows.length) return null;
  const key = masterKey(row['Order number'], row['Order amount'], row.Date);
  return key !== null && masterKeys.has(key);
}