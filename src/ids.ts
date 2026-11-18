// 日本の法人番号と適格請求書発行事業者の登録番号（インボイス番号）の確かめ。
// 法人番号の検査用数字は国税庁の資料（https://www.houjin-bangou.nta.go.jp/documents/checkdigit.pdf）どおり:
//   12桁の基礎番号の、最下位から偶数桁の和×2 ＋ 奇数桁の和 を9で割った余りを、9から引く。
export class InputError extends Error {}

const HOUJIN_LOOKUP = 'https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouNo=';
const INVOICE_LOOKUP = 'https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=';

/** 全角の数字・英字をそろえ、空白・ハイフン類を取る。 */
export function normalize(raw: string): string {
  return raw
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐－―ー−‒–—_.,]/g, '')
    .toUpperCase();
}

export function checkDigitFor(base12: string): number {
  if (!/^\d{12}$/.test(base12)) throw new InputError('base number must be exactly 12 digits');
  let even = 0;
  let odd = 0;
  for (let n = 1; n <= 12; n++) {
    const digit = Number(base12[12 - n]); // n=1 が最下位
    if (n % 2 === 0) even += digit; else odd += digit;
  }
  return 9 - ((even * 2 + odd) % 9);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 64) throw new InputError(`${field} must be a non-empty string (max 64 chars)`);
  return value;
}

export function validateCorporateNumber(value: unknown) {
  const input = requireString(value, 'number');
  const n = normalize(input).replace(/^T/, '');
  if (!/^\d{13}$/.test(n)) {
    return { input, normalized: n, valid: false, reason: `a corporate number has exactly 13 digits; got ${n.replace(/\D/g, '').length} digits` };
  }
  const expected = checkDigitFor(n.slice(1));
  const valid = Number(n[0]) === expected;
  return {
    input,
    normalized: n,
    valid,
    check_digit: Number(n[0]),
    expected_check_digit: expected,
    base_number: n.slice(1),
    reason: valid ? 'check digit matches the National Tax Agency formula' : `check digit should be ${expected}, not ${n[0]} (likely a typo)`,
    lookup_url: valid ? HOUJIN_LOOKUP + n : null,
    note: 'A valid check digit means the number is well-formed, not that the company exists. Open lookup_url to confirm the registered name and address.',
  };
}

export function corporateNumberFromBase(value: unknown) {
  const input = requireString(value, 'base_number');
  const base = normalize(input);
  const digit = checkDigitFor(base);
  const full = `${digit}${base}`;
  return { base_number: base, check_digit: digit, corporate_number: full, invoice_number_if_registered: `T${full}`, lookup_url: HOUJIN_LOOKUP + full };
}

export function validateInvoiceNumber(value: unknown) {
  const input = requireString(value, 'number');
  const n = normalize(input);
  if (!/^T\d{13}$/.test(n)) {
    const digits = n.replace(/\D/g, '');
    const reason = !n.startsWith('T')
      ? 'a qualified invoice registration number starts with "T" followed by 13 digits'
      : `expected 13 digits after "T"; got ${digits.length}`;
    return { input, normalized: n, valid_format: false, reason };
  }
  const digits = n.slice(1);
  const corp = Number(digits[0]) === checkDigitFor(digits.slice(1));
  return {
    input,
    normalized: n,
    valid_format: true,
    matches_corporate_number_check_digit: corp,
    likely_holder: corp ? 'corporation (T + corporate number)' : 'not a valid corporate number: either a typo, or a sole proprietor / other business whose 13-digit number is not a corporate number',
    corporate_number: corp ? digits : null,
    reason: corp
      ? 'format is valid and the 13 digits pass the corporate number check digit'
      : 'format is valid, but the 13 digits fail the corporate number check digit. The National Tax Agency does not publish a check scheme for sole proprietors\' numbers, so this cannot be decided offline',
    lookup_url: INVOICE_LOOKUP + digits,
    note: 'Whether the number is actually registered (and not cancelled) can only be confirmed on the official publication site: open lookup_url.',
  };
}

/** 請求書などの文面から、インボイス番号と法人番号らしいものを拾って確かめる。 */
export function extractBusinessIds(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) throw new InputError('text must be a non-empty string');
  if (value.length > 20_000) throw new InputError('text must be 20,000 characters or less');
  const text = value.replace(/[０-９Ｔｔ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const found: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const invoiceRe = /[Tt][\s\-]?((?:\d[\s\-]?){12}\d)/g;
  for (const m of text.matchAll(invoiceRe)) {
    const key = 'T' + m[1].replace(/\D/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ kind: 'invoice_registration_number', match: m[0], ...validateInvoiceNumber(key) });
  }
  const corpRe = /(?<![\dTt])(\d{13})(?!\d)/g;
  for (const m of text.matchAll(corpRe)) {
    if (seen.has('T' + m[1]) || seen.has(m[1])) continue;
    seen.add(m[1]);
    const r = validateCorporateNumber(m[1]);
    if (r.valid) found.push({ kind: 'corporate_number', match: m[0], ...r });
  }
  return { count: found.length, ids: found.slice(0, 50) };
}
