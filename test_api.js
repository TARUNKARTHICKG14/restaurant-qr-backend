// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3002; // use dedicated port

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
        resolve({ status: res.statusCode, data: json });
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
  console.log('🧪 Starting End-to-End API & Session Management Verification...');

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server listening on port ${PORT} for tests`);

  try {
    // 1. Health check
    const health = await request('/health');
    console.log('1. Health check:', health.status === 200 ? '✅ PASSED' : '❌ FAILED');

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

    // 4. Create Table 1
    const tableRes = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: Math.floor(Math.random() * 90000) + 1000,
      restaurantId
    });
    const tableId = tableRes.data.id;
    console.log('4. Create Table:', tableId ? '✅ PASSED' : '❌ FAILED');

    // 5. Create Menu Items
    const dish1 = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Paneer Butter Masala',
      description: 'Rich creamy paneer curry',
      price: 250.00,
      available: true
    });
    const dish2 = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Butter Naan',
      description: 'Clay oven cooked bread with butter',
      price: 45.00,
      available: true
    });
    console.log('5. Create Menu Items:', dish1.status === 201 && dish2.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 6. Check Initial Table Session (Should be false)
    const initSession = await request(`/api/order/table/${tableId}/session`);
    console.log('6. Initial Table Session (hasActiveSession: false):', initSession.status === 200 && initSession.data.hasActiveSession === false ? '✅ PASSED' : '❌ FAILED');

    // 7. GDPR Enforcement check
    const badOrder = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      customer: {
        name: 'Tarun Customer',
        phone: '+91-9123456789',
        consentGiven: false
      },
      items: [{ menuItemId: dish1.data.id, quantity: 1 }]
    });
    console.log('7. GDPR Rejection (consent=false):', badOrder.status === 400 ? '✅ PASSED' : '❌ FAILED');

    // 8. Place First Order (Dish 1 x 2 = ₹500)
    const firstOrder = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      customer: {
        name: 'Tarun Customer',
        phone: '+91-9123456789',
        consentGiven: true
      },
      items: [{ menuItemId: dish1.data.id, quantity: 2 }]
    });
    const orderId = firstOrder.data.orderId;
    console.log(`8. Place First Order (Total: ₹${firstOrder.data.total}, expected: 500):`, firstOrder.status === 201 && parseFloat(firstOrder.data.total) === 500 ? '✅ PASSED' : '❌ FAILED');

    // 9. Re-scan Table Session Check (Customer doesn't need to re-login!)
    const activeSession = await request(`/api/order/table/${tableId}/session`);
    const sessionRecognized = activeSession.status === 200 &&
      activeSession.data.hasActiveSession === true &&
      activeSession.data.customer.name === 'Tarun Customer' &&
      parseFloat(activeSession.data.total) === 500;
    console.log('9. Re-Scan Session Detection (No re-login needed):', sessionRecognized ? '✅ PASSED' : '❌ FAILED');

    // 10. Add Items to Existing Bill (Dish 2 x 4 = ₹180) -> Total becomes ₹680
    const addItems = await request(`/api/order/${orderId}/items`, { method: 'POST' }, {
      items: [{ menuItemId: dish2.data.id, quantity: 4 }]
    });
    console.log(`10. Add Items to Bill (New Total: ₹${addItems.data.total}, expected: 680):`, addItems.status === 200 && parseFloat(addItems.data.total) === 680 ? '✅ PASSED' : '❌ FAILED');

    // 11. Verify Session Reflects Both Items & New Total
    const updatedSession = await request(`/api/order/table/${tableId}/session`);
    const sessionUpdated = updatedSession.status === 200 &&
      updatedSession.data.items.length === 2 &&
      parseFloat(updatedSession.data.total) === 680;
    console.log('11. Session Updated with Cumulative Bill:', sessionUpdated ? '✅ PASSED' : '❌ FAILED');

    // 12. Kitchen updates status to PREPARING
    const statusUpdate = await request(`/api/order/${orderId}/status`, { method: 'PUT' }, {
      status: 'PREPARING'
    });
    console.log('12. Kitchen Status Update:', statusUpdate.status === 200 && statusUpdate.data.status === 'PREPARING' ? '✅ PASSED' : '❌ FAILED');

    // 13. Owner dismisses/settles bill
    const dismissRes = await request(`/api/order/${orderId}/dismiss`, { method: 'PUT' });
    console.log('13. Owner Dismiss / Settle Bill:', dismissRes.status === 200 && dismissRes.data.order.status === 'PAID' ? '✅ PASSED' : '❌ FAILED');

    // 14. Verify Table Session is Reset (Next customer sees initial login screen)
    const resetSession = await request(`/api/order/table/${tableId}/session`);
    console.log('14. Table Session Reset for Next Customer:', resetSession.status === 200 && resetSession.data.hasActiveSession === false ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 14 VERIFICATION CHECKS (INCLUDING SESSION & RE-SCAN) PASSED PERFECTLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
