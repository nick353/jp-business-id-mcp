import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDigitFor, corporateNumberFromBase, extractBusinessIds, validateCorporateNumber, validateInvoiceNumber } from '../src/ids.ts';

test('国税庁の資料の例: 700110005901 → 8', () => {
  assert.equal(checkDigitFor('700110005901'), 8);
  assert.equal(corporateNumberFromBase('700110005901').corporate_number, '8700110005901');
});
test('法人番号の確かめ', () => {
  assert.equal(validateCorporateNumber('8700110005901').valid, true);
  assert.equal(validateCorporateNumber('８７００-１１０-００５９０１').valid, true);
  const bad = validateCorporateNumber('1700110005901');
  assert.equal(bad.valid, false);
  assert.equal(bad.expected_check_digit, 8);
  assert.equal(validateCorporateNumber('870011000590').valid, false);
});
test('インボイス番号', () => {
  const ok = validateInvoiceNumber('T8700110005901');
  assert.equal(ok.valid_format, true);
  assert.equal(ok.matches_corporate_number_check_digit, true);
  assert.equal(ok.corporate_number, '8700110005901');
  assert.equal(validateInvoiceNumber('ｔ８７００１１０００５９０１').valid_format, true);
  const sole = validateInvoiceNumber('T1234567890123');
  assert.equal(sole.valid_format, true);
  assert.equal(sole.matches_corporate_number_check_digit, false);
  assert.equal(validateInvoiceNumber('8700110005901').valid_format, false);
  assert.equal(validateInvoiceNumber('T870011000590').valid_format, false);
});
test('文面から拾う', () => {
  const r = extractBusinessIds('株式会社サンプル\n登録番号：T8700110005901\n法人番号 8700110005901 です。電話 0312345678');
  assert.equal(r.count, 1);
  assert.equal(r.ids[0].kind, 'invoice_registration_number');
  const r2 = extractBusinessIds('法人番号: 8700110005901');
  assert.equal(r2.count, 1);
  assert.equal(r2.ids[0].kind, 'corporate_number');
});
