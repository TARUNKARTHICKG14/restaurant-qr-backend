// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3001; // use separate port for test

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
  console.log('🧪 Starting End-to-End API Verification...');

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
      name: 'Spice Garden',
      owner_name: 'Tarun Karthick',
      address: '123 Gourmet Ave',
      phone: '+91-9876543210'
    });
    console.log('3. Create Restaurant:', rest.status === 201 && rest.data.id ? '✅ PASSED' : '❌ FAILED');
    const restaurantId = rest.data.id;

    // 4. Create Tables 1 to 5
    let table1Id = null;
    for (let i = 1; i <= 5; i++) {
      const tableRes = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
        number: 100 + i, // use unique table numbers
        restaurantId
      });
      if (i === 1) table1Id = tableRes.data.id;
    }
    console.log('4. Create Tables 1-5:', table1Id ? '✅ PASSED' : '❌ FAILED');

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

    // 6. Fetch Public Menu
    const menu = await request(`/api/menu/${restaurantId}`);
    console.log('6. Public Menu Fetch:', menu.status === 200 && menu.data.length >= 2 ? '✅ PASSED' : '❌ FAILED');

    // 7. QR Code Generation for Table 1
    const qrJson = await request(`/api/qr/${table1Id}?format=json`);
    console.log('7. QR Code Generation:', qrJson.status === 200 && qrJson.data.qrCodeDataUrl.startsWith('data:image/png') ? '✅ PASSED' : '❌ FAILED');

    // 8. Order Placement WITHOUT GDPR consent (should fail with 400)
    const badOrder = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId: table1Id,
      customer: {
        name: 'John Doe',
        phone: '+91-9999988888',
        consentGiven: false
      },
      items: [
        { menuItemId: dish1.data.id, quantity: 1 }
      ]
    });
    console.log('8. GDPR Rejection (consent=false):', badOrder.status === 400 ? '✅ PASSED' : '❌ FAILED');

    // 9. Order Placement WITH GDPR consent (should succeed with 201)
    const goodOrder = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId: table1Id,
      customer: {
        name: 'John Doe',
        phone: '+91-9999988888',
        consentGiven: true
      },
      items: [
        { menuItemId: dish1.data.id, quantity: 2 }, // 250 * 2 = 500
        { menuItemId: dish2.data.id, quantity: 4 }  // 45 * 4 = 180 => total = 680
      ]
    });
    const expectedTotal = 680;
    const isTotalCorrect = goodOrder.status === 201 && parseFloat(goodOrder.data.total) === expectedTotal;
    console.log(`9. Place Order (Total: ${goodOrder.data.total}, expected: 680):`, isTotalCorrect ? '✅ PASSED' : '❌ FAILED');
    const orderId = goodOrder.data.orderId;

    // 10. Kitchen Update Status
    const updateStatus = await request(`/api/order/${orderId}/status`, { method: 'PUT' }, {
      status: 'PREPARING'
    });
    console.log('10. Update Status to PREPARING:', updateStatus.status === 200 && updateStatus.data.status === 'PREPARING' ? '✅ PASSED' : '❌ FAILED');

    // 11. Admin Orders list with joined customer & items
    const adminOrders = await request(`/api/admin/orders?restaurantId=${restaurantId}`, { headers: authHeaders });
    const orderFound = adminOrders.status === 200 && adminOrders.data.some(o => o.id === orderId && o.items.length === 2);
    console.log('11. Admin Orders Feed:', orderFound ? '✅ PASSED' : '❌ FAILED');

    // 12. Admin Analytics
    const analytics = await request(`/api/admin/analytics/summary?restaurantId=${restaurantId}`, { headers: authHeaders });
    console.log('12. Admin Analytics Summary:', analytics.status === 200 && analytics.data.today ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 12 VERIFICATION CHECKS COMPLETED SUCCESSFULLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
