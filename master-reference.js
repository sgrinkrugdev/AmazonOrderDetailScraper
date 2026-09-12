// Optional reference rows. Personal transaction records are excluded.
const masterRows = [];
function masterKey(order, amount, date) {
  if (!String(amount ?? '').trim() || !Number.isFinite(Number(amount)) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  return [String(order || '').trim(), Math.round(Number(amount) * 100), date].join('|');
}
const masterKeys = new Set(masterRows.map(r => masterKey(r.order, r.amount, r.date)).filter(Boolean));
function matchesMaster(row) {
  if (!masterRows.length) return null;
  const key = masterKey(row['Order number'], row['Order amount'], row.Date);
  return key !== null && masterKeys.has(key);
}

