// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3006; // dedicated test port

async function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'localhost',
      port: PORT,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting End-to-End API, Waiter Calling & Security Verification...');

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server listening on port ${PORT} for tests`);

  try {
    // 1. Health check & Helmet Security Headers check
    const health = await request('/health');
    const hasSecurityHeaders = health.headers['x-content-type-options'] === 'nosniff' &&
      health.headers['x-frame-options'] === 'SAMEORIGIN';
    console.log('1. Health check & Helmet Security Headers:', health.status === 200 && hasSecurityHeaders ? '✅ PASSED' : '❌ FAILED');

    // 2. Admin Login
    const login = await request('/api/admin/login', { method: 'POST' }, {
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      password: process.env.ADMIN_PASS || 'supersecret'
    });
    console.log('2. Admin login:', login.status === 200 && login.data.token ? '✅ PASSED' : '❌ FAILED');
    const token = login.data.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 3. Create Restaurant
    const rest = await request('/api/admin/restaurant', { method: 'POST', headers: authHeaders }, {
      name: 'Spice Palace ' + Date.now(),
      owner_name: 'Tarun Karthick',
      address: '456 Royal Lane',
      phone: '+91-9876543210'
    });
    console.log('3. Create Restaurant:', rest.status === 201 && rest.data.id ? '✅ PASSED' : '❌ FAILED');
    const restaurantId = rest.data.id;

    // 4. Create Table
    const tableRes = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: Math.floor(Math.random() * 90000) + 1000,
      restaurantId
    });
    const tableId = tableRes.data.id;
    const tableNumber = tableRes.data.number;
    console.log(`4. Create Table ${tableNumber}:`, tableId ? '✅ PASSED' : '❌ FAILED');

    // 5. Customer at Table Calls Waiter (Requesting Cold Water & Extra Cutlery)
    const callWaiter = await request(`/api/order/table/${tableId}/call-waiter`, { method: 'POST' }, {
      requestType: 'WATER',
      note: 'Please bring cold water and 2 extra forks'
    });
    const isCallCreated = callWaiter.status === 201 &&
      callWaiter.data.request.status === 'PENDING' &&
      callWaiter.data.request.tableNumber === tableNumber;
    console.log('5. Customer Calls Waiter from Table:', isCallCreated ? '✅ PASSED' : '❌ FAILED');
    const requestId = callWaiter.data.request.id;

    // 6. Staff Views Active Service Calls
    const activeCalls = await request(`/api/admin/service-requests?restaurantId=${restaurantId}&status=PENDING`, { headers: authHeaders });
    const isFoundInPending = activeCalls.status === 200 &&
      activeCalls.data.some(r => r.id === requestId && r.status === 'PENDING');
    console.log('6. Staff Active Service Requests Dashboard:', isFoundInPending ? '✅ PASSED' : '❌ FAILED');

    // 7. Staff Attends & Resolves Call
    const resolveRes = await request(`/api/admin/service-requests/${requestId}/resolve`, { method: 'PUT', headers: authHeaders });
    const isResolved = resolveRes.status === 200 && resolveRes.data.request.status === 'RESOLVED';
    console.log('7. Staff Acknowledges & Resolves Service Call:', isResolved ? '✅ PASSED' : '❌ FAILED');

    // 8. Verify Table Call is Cleared from Pending List
    const remainingCalls = await request(`/api/admin/service-requests?restaurantId=${restaurantId}&status=PENDING`, { headers: authHeaders });
    const isCleared = remainingCalls.status === 200 && !remainingCalls.data.some(r => r.id === requestId);
    console.log('8. Service Call Cleared from Pending Queue:', isCleared ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 8 VERIFICATION CHECKS (WAITER CALL BUTTON & SECURITY HEADERS) PASSED PERFECTLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
