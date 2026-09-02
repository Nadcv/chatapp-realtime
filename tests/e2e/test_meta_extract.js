function extractMetaContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["']`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

const sampleHtml = `
<html><head>
<title>Fallback Title</title>
<meta property="og:title" content="Example Article Title">
<meta property="og:description" content="This is a test description for the preview card.">
<meta property="og:image" content="/images/preview.jpg">
</head><body></body></html>
`;
console.log('title:', extractMetaContent(sampleHtml, 'og:title'));
console.log('description:', extractMetaContent(sampleHtml, 'og:description'));
console.log('image:', extractMetaContent(sampleHtml, 'og:image'));
console.log('fallback title match:', sampleHtml.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);

const reversedHtml = '<meta content="Reversed Order Title" property="og:title">';
console.log('reversed order title:', extractMetaContent(reversedHtml, 'og:title'));

const noOgHtml = '<meta name="description" content="Plain description meta, no OG.">';
console.log('fallback to plain description meta:', extractMetaContent(noOgHtml, 'og:description') || extractMetaContent(noOgHtml, 'description'));

const resolved = new URL('/images/preview.jpg', new URL('https://example.com/articles/1'));
console.log('resolved relative image:', resolved.toString());

function isPrivateOrReservedIp(ip) {
  const net = require('net');
  const kind = net.isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.split(':').pop());
    return false;
  }
  return true;
}
const ipTests = {
  '127.0.0.1': true, 'localhost-resolved-would-be-127': null,
  '10.0.0.5': true, '172.16.0.1': true, '172.66.147.243': false, // example.com's real IP — must NOT be blocked
  '192.168.1.1': true, '169.254.169.254': true, '8.8.8.8': false,
  '::1': true, 'fe80::1': true, '2606:4700::1': false,
};
Object.entries(ipTests).forEach(([ip, expected]) => {
  if (expected === null) return;
  const actual = isPrivateOrReservedIp(ip);
  console.log(`isPrivateOrReservedIp(${ip}) = ${actual} (expected ${expected}):`, actual === expected);
});
