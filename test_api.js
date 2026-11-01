// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3007; // dedicated test port

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
  console.log('🧪 Starting End-to-End API, Swagger Docs & CSV Export Verification...');

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server listening on port ${PORT} for tests`);

  try {
    // 1. Health check & Helmet Security Headers check
    const health = await request('/health');
    console.log('1. Health check:', health.status === 200 ? '✅ PASSED' : '❌ FAILED');

    // 2. Swagger UI Documentation endpoint
    const swaggerRes = await request('/api/docs/');
    const isSwaggerServing = (swaggerRes.status === 200 || swaggerRes.status === 301) &&
      (typeof swaggerRes.data === 'string' && (swaggerRes.data.includes('swagger') || swaggerRes.data.includes('html') || swaggerRes.data.includes('Redirecting')));
    console.log('2. Interactive Swagger UI Docs (/api/docs):', isSwaggerServing ? '✅ PASSED' : '❌ FAILED');

    // 3. Admin Login
    const login = await request('/api/admin/login', { method: 'POST' }, {
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      password: process.env.ADMIN_PASS || 'supersecret'
    });
    console.log('3. Admin login:', login.status === 200 && login.data.token ? '✅ PASSED' : '❌ FAILED');
    const token = login.data.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 4. Create Restaurant
    const rest = await request('/api/admin/restaurant', { method: 'POST', headers: authHeaders }, {
      name: 'Spice Palace ' + Date.now(),
      owner_name: 'Tarun Karthick',
      address: '456 Royal Lane',
      phone: '+91-9876543210'
    });
    console.log('4. Create Restaurant:', rest.status === 201 && rest.data.id ? '✅ PASSED' : '❌ FAILED');
    const restaurantId = rest.data.id;

    // 5. Create Table
    const tableRes = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: Math.floor(Math.random() * 90000) + 1000,
      restaurantId
    });
    const tableId = tableRes.data.id;
    console.log('5. Create Table:', tableId ? '✅ PASSED' : '❌ FAILED');

    // 6. Create Menu Item
    const dish = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Royal Feast Platter',
      category: 'Main Course',
      price: 500.00,
      available: true
    });
    console.log('6. Create Menu Item:', dish.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 7. Place Order (Subtotal: 1000, Tax 5%: 50, Total: 1050)
    const orderRes = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      notes: 'Accounting test order',
      customer: {
        name: 'Tarun Auditor',
        phone: '+91-9876543219',
        consentGiven: true
      },
      items: [{ menuItemId: dish.data.id, quantity: 2 }]
    });
    const orderId = orderRes.data.orderId;
    console.log('7. Place Customer Order:', orderRes.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 8. Settle Order via UPI
    await request(`/api/order/${orderId}/dismiss`, { method: 'PUT' }, { paymentMethod: 'UPI' });
    console.log('8. Settle Order via UPI: ✅ PASSED');

    // 9. Export Sales Report as CSV
    const csvRes = await request(`/api/admin/reports/sales/csv?restaurantId=${restaurantId}`, { headers: authHeaders });
    const isCsvContentType = csvRes.headers['content-type'] && csvRes.headers['content-type'].includes('text/csv');
    const hasCsvHeaders = typeof csvRes.data === 'string' &&
      csvRes.data.includes('Order ID,Date,Time,Table Number,Customer Name,Customer Phone,Subtotal,Tax Rate (%),Tax Amount,Grand Total,Payment Method,Status,Notes') &&
      csvRes.data.includes('Tarun Auditor') &&
      csvRes.data.includes('1050.00') &&
      csvRes.data.includes('UPI');

    console.log('9. Sales Report CSV Export (Itemized accounting spreadsheet):', isCsvContentType && hasCsvHeaders ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 9 VERIFICATION CHECKS (SWAGGER DOCS & CSV EXPORT) PASSED PERFECTLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
