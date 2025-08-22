/**
 * 🧪 API SECURITY TEST SCRIPT
 * Test semua endpoint untuk memastikan protected dari unauthorized access
 */

const https = require('https');
const http = require('http');

const API_BASE = 'http://localhost:3000';

// Test cases
const testCases = [
  {
    name: 'Direct browser access to /api',
    path: '/api',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    expectedStatus: 404,
    description: 'Should block direct browser access'
  },
  {
    name: 'Direct browser access to /api/events',
    path: '/api/events',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    expectedStatus: 404,
    description: 'Should block direct browser access to events'
  },
  {
    name: 'Unauthorized API access without token',
    path: '/api/events',
    headers: {
      'User-Agent': 'curl/7.68.0',
      'Accept': 'application/json'
    },
    expectedStatus: 404,
    description: 'Should block unauthorized API access'
  },
  {
    name: 'Valid mobile app access',
    path: '/api/events',
    headers: {
      'User-Agent': 'DanceSignal/1.0.0 (Flutter)',
      'Accept': 'application/json',
      'X-Client-Type': 'mobile'
    },
    expectedStatus: 200,
    description: 'Should allow valid mobile app access'
  },
  {
    name: 'API access with JWT token',
    path: '/api/events',
    headers: {
      'Authorization': 'Bearer fake-jwt-token-for-testing',
      'Accept': 'application/json'
    },
    expectedStatus: 200,
    description: 'Should allow access with JWT token'
  },
  {
    name: 'Emergency bypass (development)',
    path: '/api/events',
    headers: {
      'X-Emergency-Bypass': 'dev-emergency-bypass-2024',
      'Accept': 'application/json'
    },
    expectedStatus: 200,
    description: 'Should allow emergency bypass in development'
  },
  {
    name: 'Health check access',
    path: '/api/security/health',
    headers: {
      'Accept': 'application/json'
    },
    expectedStatus: 200,
    description: 'Should allow health check access'
  }
];

/**
 * Make HTTP request
 */
function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

/**
 * Run security tests
 */
async function runSecurityTests() {
  console.log('🧪 Starting API Security Tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    console.log(`🔍 Testing: ${testCase.name}`);
    console.log(`   Description: ${testCase.description}`);
    console.log(`   Path: ${testCase.path}`);
    
    try {
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: testCase.path,
        method: 'GET',
        headers: testCase.headers
      };
      
      const response = await makeRequest(options);
      
      console.log(`   Response: ${response.statusCode}`);
      console.log(`   Expected: ${testCase.expectedStatus}`);
      
      if (response.statusCode === testCase.expectedStatus) {
        console.log(`   ✅ PASSED\n`);
        passed++;
      } else {
        console.log(`   ❌ FAILED`);
        console.log(`   Response body: ${response.body.substring(0, 200)}...\n`);
        failed++;
      }
      
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}\n`);
      failed++;
    }
    
    // Wait a bit between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('📊 TEST RESULTS:');
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   Total: ${testCases.length}`);
  
  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! API is properly secured.');
  } else {
    console.log('\n⚠️ Some tests failed. Please check the security configuration.');
  }
}

// Check if server is running
console.log('🚀 Checking if server is running...');
http.get(`${API_BASE}/health`, (res) => {
  if (res.statusCode === 200) {
    console.log('✅ Server is running\n');
    runSecurityTests().catch(console.error);
  } else {
    console.log('❌ Server not responding properly');
  }
}).on('error', (error) => {
  console.log('❌ Server not running. Please start the server first:');
  console.log('   cd api && npm start');
  console.log('\nThen run this test again:');
  console.log('   node test-api-security.js');
});
