// Builds /llms.txt - the site summarised for AI assistants - from the
// pages themselves, so it can never say something the site doesn't.
//
//   node .github/scripts/llms.mjs           rewrite llms.txt
//   node .github/scripts/llms.mjs --check   fail if llms.txt is out of date
//
// llms.txt is a proposal (llmstxt.org), not a standard: no big search
// engine says it reads it, and what ChatGPT or Claude really read is each
// page's HTML and its JSON-LD. It is published anyway because it costs
// this little and the browsing agents (the ones that open a page when
// someone asks their assistant "look at this site") do read it.
//
// Not a single fact is written here: titles, descriptions, price,
// shipping, contact and stockists are read from index.html and
// en/index.html (their <title>, meta description, JSON-LD and stockist
// links). If a page changes and llms.txt is not rebuilt, the GitHub
// Action in .github/workflows/buscadores.yml fails with --check, so a
// stale summary doesn't go unnoticed.
//
// Lives under .github/ because Jekyll (GitHub Pages) doesn't publish
// folders that start with a dot; llms.txt itself, at the root, is.
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://siuranaoutdoors.com';
const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function page(path, url) {
  const html = read(path);
  const title = decode(html.match(/<title>([^<]+)<\/title>/)[1]);
  const description = decode(html.match(/<meta name="description" content="([^"]+)"/)[1]);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const org = graph.find((n) => n['@type'] === 'Organization');
  const product = graph.find((n) => n['@type'] === 'Product');
  const block = (html.match(/<span class="stockist-links">([\s\S]*?)<\/span><\/span>/) || [])[1] || '';
  const stockists = [...block.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => ({ name: decode(m[2]), url: m[1] }));
  return { url, title, description, org, product, stockists };
}

function legalTitle(path) {
  return decode(read(path).match(/<title>([^<]+)<\/title>/)[1]);
}

const es = page('index.html', `${SITE}/`);
const en = page('en/index.html', `${SITE}/en/`);
const { org, product } = es;
const offer = product.offers;
const shipping = offer.shippingDetails;

const lines = [
  `# ${org.name}`,
  '',
  `> ${es.description}`,
  '',
  `> ${en.description}`,
  '',
  `- Producto / Product: ${product.name} (${product.sku})`,
  `- ${product.description}`,
  `- Precio en la web / Online price: ${offer.price} ${offer.priceCurrency}`,
  shipping && `- Envío / Shipping: ${shipping.shippingRate.value} ${shipping.shippingRate.currency} (${shipping.shippingDestination.addressCountry})`,
  org.email && `- Email: ${org.email}`,
  org.telephone && `- Teléfono / WhatsApp: ${org.telephone}`,
  ...(org.sameAs || []).map((u) => `- ${u}`),
  '',
  '## Páginas / Pages',
  '',
  `- [${es.title}](${es.url}): ${es.description}`,
  `- [${en.title}](${en.url}): ${en.description}`,
  `- [Comprar / Order (ES)](${SITE}/pedido/)`,
  `- [Order (EN)](${SITE}/en/order/)`,
  '',
  '## Puntos de venta / Stockists',
  '',
  ...es.stockists.map((s) => `- [${s.name}](${s.url})`),
  '',
  '## Legal',
  '',
  `- [${legalTitle('privacidad/index.html')}](${SITE}/privacidad/)`,
  `- [${legalTitle('en/privacy/index.html')}](${SITE}/en/privacy/)`,
].filter((l) => typeof l === 'string'); // drops the facts a page doesn't publish

const text = lines.join('\n') + '\n';
const target = new URL('llms.txt', root);

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n'); } catch {}
  if (current !== text) {
    console.error('llms.txt is out of date: run `node .github/scripts/llms.mjs` and commit it.');
    process.exit(1);
  }
  console.log('llms.txt is up to date with the pages.');
} else {
  writeFileSync(target, text);
  console.log(`llms.txt written (${lines.length} lines).`);
}
