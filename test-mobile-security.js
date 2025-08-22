const axios = require('axios');

console.log('🧪 Testing Mobile App Security Fixes...\n');

const API_BASE = 'http://localhost:3000';

// Test different mobile user agents
const mobileUserAgents = [
  'DanceSignal/1.0 (Android 11; Mobile)',
  'Dart/2.19 (dart:io)',
  'Mozilla/5.0 (Linux; Android 11; SM-G973F) AppleWebKit/537.36',
  'okhttp/4.9.0',
  'Flutter/3.0',
  'Apache-HttpClient/4.5.1 (Java/1.8.0_151)',
  'CFNetwork/1329.0.1 Darwin/21.3.0'
];

async function testEndpoint(path, userAgent, description) {
  try {
    console.log(`🔍 Testing: ${description}`);
    console.log(`   Endpoint: ${API_BASE}${path}`);
    console.log(`   User-Agent: ${userAgent}`);
    
    const response = await axios.get(`${API_BASE}${path}`, {
      headers: {
        'User-Agent': userAgent,
        'X-Client-Type': 'mobile'
      },
      timeout: 5000
    });
    
    console.log(`✅ SUCCESS: ${response.status} - ${description}`);
    console.log(`   Response time: ${response.headers['x-response-time'] || 'N/A'}`);
    return true;
    
  } catch (error) {
    console.log(`❌ FAILED: ${description}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Message: ${error.response.data?.message || 'Unknown error'}`);
    } else {
      console.log(`   Network Error: ${error.message}`);
    }
    return false;
  }
}

async function runTests() {
  console.log(`📱 Testing Mobile Security with various user agents...\n`);
  
  // Test public endpoints
  const publicEndpoints = [
    { path: '/api/health', desc: 'Health Check' },
    { path: '/api/events', desc: 'Public Events' },
    { path: '/api/artists', desc: 'Public Artists' },
    { path: '/api/venues', desc: 'Public Venues' },
    { path: '/api/cities', desc: 'Public Cities' },
    { path: '/api/daily-drop', desc: 'Daily Drop' }
  ];
  
  let totalTests = 0;
  let passedTests = 0;
  
  for (const userAgent of mobileUserAgents) {
    console.log(`\n📱 Testing with User-Agent: ${userAgent.substring(0, 50)}...`);
    
    for (const endpoint of publicEndpoints) {
      totalTests++;
      const passed = await testEndpoint(endpoint.path, userAgent, endpoint.desc);
      if (passed) passedTests++;
    }
  }
  
  console.log(`\n📊 Test Results:`);
  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   Passed: ${passedTests}`);
  console.log(`   Failed: ${totalTests - passedTests}`);
  console.log(`   Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  if (passedTests === totalTests) {
    console.log(`\n🎉 ALL TESTS PASSED! Mobile security fixes are working!`);
  } else {
    console.log(`\n⚠️ Some tests failed. Check security configuration.`);
  }
}

runTests().catch(console.error);
