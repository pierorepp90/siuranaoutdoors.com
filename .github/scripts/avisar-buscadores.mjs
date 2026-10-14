// After GitHub Pages publishes the site: check it as the AI crawlers see
// it, then tell Bing (and through it ChatGPT and Copilot) about every
// address in the sitemap, with IndexNow.
//
//   node .github/scripts/avisar-buscadores.mjs
//
// Run by .github/workflows/buscadores.yml when "pages build and
// deployment" finishes on main. It can also be run by hand.
//
// 1. The guard. Cloudflare (which sits in front of this domain) has "AI
//    bots" switches that block ChatGPT's or Claude's crawlers without
//    touching any code, and the site keeps looking perfect in a browser.
//    So the home page is requested as each crawler, and anything but 200
//    fails the workflow, which emails whoever pushed.
// 2. IndexNow. Bing, Yandex, Seznam, Naver and Yep take it; Google
//    doesn't (it gets the sitemap from Search Console). The key is not
//    secret: IndexNow asks for it published at the root
//    (/<key>.txt) to check the ping comes from the site's owner. This key
//    belongs to this site only.
//    A failed ping never fails the workflow: the site is already live.

const SITE = 'https://siuranaoutdoors.com';
const KEY = 'ee518295e61df037955f58ab40b84a85';

const AI_CRAWLERS = [
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'
];

const problems = [];
for (const ua of AI_CRAWLERS) {
  const name = ua.match(/compatible; ([^;]+);/)[1];
  try {
    const res = await fetch(`${SITE}/`, { headers: { 'user-agent': ua, 'cache-control': 'no-cache' } });
    if (res.status !== 200) problems.push(`${name} gets ${res.status} on the home page: that assistant can't read the site`);
  } catch (e) {
    problems.push(`${name}: no answer (${e.message})`);
  }
}
for (const path of ['/robots.txt', '/llms.txt', `/${KEY}.txt`]) {
  const res = await fetch(`${SITE}${path}`, { headers: { 'cache-control': 'no-cache' } }).catch(() => null);
  if (!res || res.status !== 200) problems.push(`${path} answers ${res ? res.status : 'nothing'}`);
}

try {
  const sitemap = await (await fetch(`${SITE}/sitemap.xml`, { headers: { 'cache-control': 'no-cache' } })).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!urls.length) throw new Error('the published sitemap lists no address');
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls })
  });
  // 200 and 202 mean "received"; 403 means it can't find the published key.
  console.log(res.ok ? `IndexNow: ${urls.length} addresses sent (${res.status})` : `IndexNow answered ${res.status}: ${await res.text()}`);
} catch (e) {
  console.log(`IndexNow could not be reached: ${e.message}`);
}

if (problems.length) {
  console.error(`Published site has problems:\n  - ${problems.join('\n  - ')}`);
  process.exitCode = 1;
} else {
  console.log('Home page OK for the five AI crawlers; robots.txt, llms.txt and the IndexNow key answer 200.');
}
