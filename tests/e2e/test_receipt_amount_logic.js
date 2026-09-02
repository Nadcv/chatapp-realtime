// Isolated unit test for the receipt-OCR amount-extraction heuristic
// (extractReceiptAmount / normalizeAmountToken in index.html), since Tesseract.js's
// CDN is blocked in this sandbox and can't be exercised through a real Playwright run.

function normalizeAmountToken(raw) {
    const decimalIndex = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
    const intPart = raw.slice(0, decimalIndex).replace(/[.,]/g, '');
    const decPart = raw.slice(decimalIndex + 1);
    const value = parseFloat(intPart + '.' + decPart);
    return isFinite(value) ? value : null;
}
function extractReceiptAmount(text) {
    const amountRe = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})(?!\d)/g;
    const totalKeywords = /total|montante|valor a pagar|amount due|grand total/i;
    let totalCandidates = [], allCandidates = [];
    (text || '').split(/\r?\n/).forEach((line) => {
        [...line.matchAll(amountRe)].forEach((m) => {
            const value = normalizeAmountToken(m[1]);
            if (value == null) return;
            allCandidates.push(value);
            if (totalKeywords.test(line)) totalCandidates.push(value);
        });
    });
    if (totalCandidates.length) return Math.max(...totalCandidates);
    if (allCandidates.length) return Math.max(...allCandidates);
    return null;
}

console.log('Simple European format (comma decimal):', normalizeAmountToken('12,50') === 12.50);
console.log('Simple US format (dot decimal):', normalizeAmountToken('12.50') === 12.50);
console.log('European thousands+decimal (1.234,56):', normalizeAmountToken('1.234,56') === 1234.56);
console.log('US thousands+decimal (1,234.56):', normalizeAmountToken('1,234.56') === 1234.56);

const receiptPT = `RESTAURANTE O BOM GAROTO
1x Bacalhau à Bras       12,50
2x Água                   2,00
1x Café                    1,20
SUBTOTAL                  15,70
TOTAL A PAGAR              15,70
Obrigado pela visita!`;
console.log('Portuguese receipt: picks the TOTAL line amount, not a line item:', extractReceiptAmount(receiptPT) === 15.70);

const receiptUS = `COFFEE SHOP
Latte              4.50
Muffin              3.25
Subtotal            7.75
Tax                 0.62
Grand Total         8.37`;
console.log('US receipt: picks Grand Total over subtotal/line items:', extractReceiptAmount(receiptUS) === 8.37);

const receiptNoTotalKeyword = `MERCADO
Pão      1,20
Leite    0,89
Ovos     2,49`;
console.log('No "total" keyword found: falls back to the largest number on the receipt:', extractReceiptAmount(receiptNoTotalKeyword) === 2.49);

console.log('Empty/garbage OCR text returns null (not a crash):', extractReceiptAmount('asdkjaslkdj  ###  no numbers here') === null);
console.log('Undefined input returns null (not a crash):', extractReceiptAmount(undefined) === null);

// A 4-digit code that's NOT a currency amount (e.g., a receipt/order number) should not
// be picked up by the regex (it requires exactly 2 trailing decimal digits after a separator).
console.log('A bare integer (order number, no decimal separator) is ignored:', extractReceiptAmount('Pedido Nº 20481\nTotal 9,90') === 9.90);

// Large thousands-formatted total (e.g. a hotel invoice).
console.log('Large European-formatted total (2.450,00) parses correctly:', extractReceiptAmount('Fatura\nTotal 2.450,00') === 2450.00);
