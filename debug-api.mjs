/**
 * Minimal debug: call AliExpress Affiliate API once and print raw JSON.
 */

import crypto from 'node:crypto';

const APP_KEY = process.env.ALI_APP_KEY || '528438';
const APP_SECRET = process.env.ALI_APP_SECRET || 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const TRACKING_ID = process.env.ALI_TRACKING_ID || 'ali_smart_finder_v1';
const API_GATEWAY = 'https://api-sg.aliexpress.com/sync';

function generateSignature(params, secret) {
  const sortedKeys = Object.keys(params).sort((a, b) => a.localeCompare(b));
  let stringToSign = secret;
  for (const key of sortedKeys) stringToSign += key + params[key];
  stringToSign += secret;
  console.log('stringToSign:', stringToSign.substring(0, 200));
  return crypto.createHash('md5').update(stringToSign).digest('hex').toUpperCase();
}

async function main() {
  const params = {
    app_key: APP_KEY,
    timestamp: new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
    method: 'aliexpress.affiliate.product.query',
    sign_method: 'md5',
    v: '2.0',
    keywords: 'wireless headphones',
    page_no: '1',
    page_size: '10',
    target_currency: 'USD',
    target_language: 'EN',
    tracking_id: TRACKING_ID,
    sort: 'SALE_PRICE_ASC'
  };
  params.sign = generateSignature(params, APP_SECRET);

  const qs = Object.keys(params).sort((a, b) => a.localeCompare(b))
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = `${API_GATEWAY}?${qs}`;
  console.log('Fetching:', url.substring(0, 180) + '...');

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();

  console.log('\n--- HTTP Status:', res.status);
  console.log('--- Raw body (first 2000 chars):');
  console.log(text.substring(0, 2000));

  try {
    const data = JSON.parse(text);
    console.log('\n--- Parsed keys:', Object.keys(data));
    if (data.aliexpress_affiliate_product_query_response) {
      const r = data.aliexpress_affiliate_product_query_response;
      console.log('--- Response keys:', Object.keys(r));
      if (r.resp_result) {
        console.log('--- resp_result keys:', Object.keys(r.resp_result));
        if (r.resp_result.result) {
          console.log('--- result keys:', Object.keys(r.resp_result.result));
          if (r.resp_result.result.products) {
            console.log('--- products keys:', Object.keys(r.resp_result.result.products));
            const prod = r.resp_result.result.products.product;
            console.log('--- product is array?', Array.isArray(prod));
            console.log('--- product length:', prod?.length ?? (prod ? 1 : 0));
          }
        }
      }
      if (r.products) {
        console.log('--- products keys (alt):', Object.keys(r.products));
        const prod = r.products.product;
        console.log('--- product is array? (alt)', Array.isArray(prod));
        console.log('--- product length (alt):', prod?.length ?? (prod ? 1 : 0));
      }
    }
    if (data.error_response) {
      console.log('--- error_response:', JSON.stringify(data.error_response, null, 2));
    }
  } catch (e) {
    console.log('--- Not valid JSON');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
