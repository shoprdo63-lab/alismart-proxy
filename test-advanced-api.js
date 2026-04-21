const axios = require('axios');
const crypto = require('crypto');

const APP_KEY = '528438';
const APP_SECRET = 'YPhzjbGESFs75SniEK0t1wwfKhvrKIhq';
const API_URL = 'https://api-sg.aliexpress.com/sync';

function generateSign(params) {
  const sortedKeys = Object.keys(params).sort();
  const sortedParams = sortedKeys.map((key) => `${key}${params[key]}`).join('');
  const signString = APP_SECRET + sortedParams + APP_SECRET;
  return crypto.createHash('md5').update(signString).digest('hex').toUpperCase();
}

async function testAPI(method, extraParams = {}) {
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const params = {
    method: method,
    app_key: APP_KEY,
    timestamp,
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    ...extraParams
  };

  params.sign = generateSign(params);

  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  try {
    console.log(`\n🧪 Testing: ${method}`);
    const response = await axios.get(`${API_URL}?${queryString}`, {
      timeout: 30000
    });
    
    const data = response.data;
    
    // Check for API errors
    if (data.error_response) {
      return {
        success: false,
        method,
        error: data.error_response,
        available: false
      };
    }
    
    // Check for results
    const result = data[`${method.replace(/\./g, '_')}_response`] || data;
    
    return {
      success: true,
      method,
      available: true,
      hasData: result && (result.result || result.products),
      sample: result
    };
  } catch (error) {
    return {
      success: false,
      method,
      error: error.message,
      available: false
    };
  }
}

async function runTests() {
  console.log('🔍 Testing AliExpress Advanced API Methods\n');
  console.log('==========================================');
  
  const tests = [
    // 1. Standard method (should work)
    {
      method: 'aliexpress.affiliate.product.query',
      params: {
        keywords: 'keyboard',
        page_size: 10,
        target_currency: 'USD',
        target_language: 'EN'
      }
    },
    
    // 2. Hot products (Advanced API)
    {
      method: 'aliexpress.affiliate.hotproduct.query',
      params: {
        keywords: 'keyboard',
        page_size: 10,
        target_currency: 'USD',
        target_language: 'EN'
      }
    },
    
    // 3. Smart match (Advanced API)
    {
      method: 'aliexpress.affiliate.product.smartmatch',
      params: {
        keywords: 'keyboard',
        target_count: 10,
        target_currency: 'USD',
        target_language: 'EN'
      }
    },
    
    // 4. Image search (if available)
    {
      method: 'aliexpress.affiliate.image.search',
      params: {
        image_url: 'https://ae01.alicdn.com/kf/HTB1tyl7bELrK1Rjy0Fjq6zYXFXaC.jpg',
        target_currency: 'USD',
        target_language: 'EN'
      }
    },
    
    // 5. Featured promo products (Advanced API)
    {
      method: 'aliexpress.affiliate.featuredpromo.products.get',
      params: {
        page_size: 10,
        target_currency: 'USD',
        target_language: 'EN'
      }
    }
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await testAPI(test.method, test.params);
    results.push(result);
    
    if (result.success && result.available) {
      console.log(`✅ ${test.method}: AVAILABLE`);
      if (result.hasData) {
        console.log(`   📦 Has data: YES`);
      }
    } else {
      console.log(`❌ ${test.method}: ${result.error?.msg || result.error || 'FAILED'}`);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n==========================================');
  console.log('📊 Summary:');
  console.log('==========================================');
  
  const available = results.filter(r => r.available).map(r => r.method);
  const unavailable = results.filter(r => !r.available).map(r => r.method);
  
  console.log(`\n✅ Available (${available.length}):`);
  available.forEach(m => console.log(`   - ${m}`));
  
  if (unavailable.length > 0) {
    console.log(`\n❌ Unavailable (${unavailable.length}):`);
    unavailable.forEach(m => console.log(`   - ${m}`));
  }
  
  // Save results
  const fs = require('fs');
  fs.writeFileSync('api-test-results.json', JSON.stringify(results, null, 2));
  console.log('\n💾 Results saved to api-test-results.json');
}

runTests().catch(console.error);
