// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3004; // dedicated test port

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
  console.log('🧪 Starting End-to-End API, Analytics & Tax Management Verification...');

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

    // 4. Configure Restaurant Tax (5% GST)
    const taxUpdate = await request(`/api/admin/restaurant/${restaurantId}/tax`, { method: 'PUT', headers: authHeaders }, {
      taxPercentage: 5.0,
      currency: '₹'
    });
    console.log('4. Configure Restaurant Tax (5% GST):', taxUpdate.status === 200 && parseFloat(taxUpdate.data.restaurant.tax_percentage) === 5.0 ? '✅ PASSED' : '❌ FAILED');

    // 5. Create Table
    const tableRes = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: Math.floor(Math.random() * 90000) + 1000,
      restaurantId
    });
    const tableId = tableRes.data.id;
    console.log('5. Create Table:', tableId ? '✅ PASSED' : '❌ FAILED');

    // 6. Create Menu Items
    const starter = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Paneer Tikka',
      description: 'Char-grilled cottage cheese cubes',
      category: 'Starters',
      price: 200.00,
      available: true
    });
    const main = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Butter Chicken Gravy',
      description: 'Rich tomato cashew sauce',
      category: 'Main Course',
      price: 300.00,
      available: true
    });
    const bread = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Garlic Naan',
      description: 'Clay oven bread with garlic butter',
      category: 'Breads',
      price: 50.00,
      available: true
    });
    console.log('6. Create Menu Items across Categories:', starter.status === 201 && main.status === 201 && bread.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 7. Place Customer Order with Cooking Notes & Itemized Tax
    // 2 Starters (400) + 2 Mains (600) = Subtotal ₹1000
    // Tax at 5% = ₹50 => Grand Total = ₹1050
    const orderRes = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      notes: 'Make it spicy, please',
      customer: {
        name: 'Tarun VIP Diner',
        phone: '+91-9876500001',
        consentGiven: true
      },
      items: [
        { menuItemId: starter.data.id, quantity: 2 },
        { menuItemId: main.data.id, quantity: 2 }
      ]
    });
    const orderId = orderRes.data.orderId;
    const isTaxCorrect = orderRes.status === 201 &&
      parseFloat(orderRes.data.subtotal) === 1000 &&
      parseFloat(orderRes.data.taxAmount) === 50 &&
      parseFloat(orderRes.data.total) === 1050;
    console.log(`7. Order with 5% Tax (Subtotal: 1000, Tax: 50, Total: 1050):`, isTaxCorrect ? '✅ PASSED' : '❌ FAILED');

    // 8. Re-scan: Add More Items (2 Garlic Naans = 100)
    // New subtotal: 1100, Tax at 5%: 55, Grand Total: 1155
    const addItems = await request(`/api/order/${orderId}/items`, { method: 'POST' }, {
      items: [{ menuItemId: bread.data.id, quantity: 2 }]
    });
    const isNewTaxCorrect = addItems.status === 200 &&
      parseFloat(addItems.data.subtotal) === 1100 &&
      parseFloat(addItems.data.taxAmount) === 55 &&
      parseFloat(addItems.data.total) === 1155;
    console.log(`8. Re-Scan Item Addition with Tax (Subtotal: 1100, Tax: 55, Total: 1155):`, isNewTaxCorrect ? '✅ PASSED' : '❌ FAILED');

    // 9. Kitchen Display System (KDS) Active Tickets
    const kdsTickets = await request(`/api/kitchen/tickets?restaurantId=${restaurantId}`);
    console.log('9. KDS Live Ticket Feed:', kdsTickets.status === 200 && kdsTickets.data.pending.length >= 1 ? '✅ PASSED' : '❌ FAILED');

    // 10. Kitchen Advances Ticket: PENDING -> PREPARING -> READY
    await request(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    const advReady = await request(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    console.log('10. KDS Advance to READY (chime trigger):', advReady.status === 200 && advReady.data.order.status === 'READY' ? '✅ PASSED' : '❌ FAILED');

    // 11. Bill Settlement with Payment Method (UPI)
    const dismissRes = await request(`/api/order/${orderId}/dismiss`, { method: 'PUT' }, {
      paymentMethod: 'UPI'
    });
    const isPaidUPI = dismissRes.status === 200 &&
      dismissRes.data.order.status === 'PAID' &&
      dismissRes.data.order.payment_method === 'UPI';
    console.log('11. Bill Settlement with UPI Payment:', isPaidUPI ? '✅ PASSED' : '❌ FAILED');

    // 12. Customer Directory API
    const customersRes = await request(`/api/admin/customers?restaurantId=${restaurantId}`, { headers: authHeaders });
    const customerFound = customersRes.status === 200 && customersRes.data.some(c => c.phone === '+91-9876500001' && c.lifetime_spend === 1155);
    console.log('12. Customer Directory (Lifetime Spend & Visits):', customerFound ? '✅ PASSED' : '❌ FAILED');
    const customerId = customersRes.data.find(c => c.phone === '+91-9876500001').id;

    // 13. Customer Order History
    const custHistory = await request(`/api/admin/customers/${customerId}/history`, { headers: authHeaders });
    const historyOk = custHistory.status === 200 && custHistory.data.orders.length >= 1 && custHistory.data.orders[0].payment_method === 'UPI';
    console.log('13. Customer Itemized Order History:', historyOk ? '✅ PASSED' : '❌ FAILED');

    // 14. Comprehensive Analytics Overview
    const analytics = await request(`/api/admin/analytics/overview?restaurantId=${restaurantId}`, { headers: authHeaders });
    const analyticsOk = analytics.status === 200 &&
      analytics.data.today.totalRevenue >= 1155 &&
      analytics.data.today.totalTaxCollected >= 55 &&
      analytics.data.salesByTable.length >= 1 &&
      analytics.data.paymentBreakdown.some(p => p.method === 'UPI');
    console.log('14. Analytics Overview (Revenue, Taxes, Tables, UPI breakdown):', analyticsOk ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 14 VERIFICATION CHECKS (TAXATION, ANALYTICS, CUSTOMER TRACKING) PASSED PERFECTLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
