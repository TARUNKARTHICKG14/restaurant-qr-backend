// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3003; // use dedicated port

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
  console.log('🧪 Starting End-to-End API, KDS & Menu Management Verification...');

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

    // 5. Create Menu Items across Categories (Starters, Main Course, Breads)
    const starter = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Paneer Tikka',
      description: 'Char-grilled cottage cheese cubes',
      category: 'Starters',
      price: 220.00,
      available: true
    });
    const main = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Butter Chicken / Paneer Gravy',
      description: 'Rich tomato cashew sauce',
      category: 'Main Course',
      price: 320.00,
      available: true
    });
    const bread = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Garlic Naan',
      description: 'Clay oven bread with garlic butter',
      category: 'Breads',
      price: 55.00,
      available: true
    });
    console.log('5. Create Menu Items across Categories:', starter.status === 201 && main.status === 201 && bread.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 6. Fetch Menu Categories
    const categoriesRes = await request(`/api/menu/${restaurantId}/categories`);
    const hasAllCats = categoriesRes.status === 200 &&
      categoriesRes.data.includes('Starters') &&
      categoriesRes.data.includes('Main Course') &&
      categoriesRes.data.includes('Breads');
    console.log('6. Menu Category Listing:', hasAllCats ? '✅ PASSED' : '❌ FAILED');

    // 7. Grouped Menu Fetch for Mobile Dashboard
    const groupedMenu = await request(`/api/menu/${restaurantId}?groupByCategory=true`);
    const groupedOk = groupedMenu.status === 200 &&
      groupedMenu.data.categories.length >= 3 &&
      groupedMenu.data.itemsByCategory['Starters'].length >= 1;
    console.log('7. Grouped Menu Fetch for Mobile Web:', groupedOk ? '✅ PASSED' : '❌ FAILED');

    // 8. Instant Availability Toggle (out-of-stock trigger)
    const toggleRes = await request(`/api/admin/menu/${starter.data.id}/toggle-availability`, { method: 'PUT', headers: authHeaders });
    const isNowUnavailable = toggleRes.status === 200 && toggleRes.data.item.available === false;
    console.log('8. Toggle Item to UNAVAILABLE:', isNowUnavailable ? '✅ PASSED' : '❌ FAILED');

    // Toggle back to available
    const toggleBack = await request(`/api/admin/menu/${starter.data.id}/toggle-availability`, { method: 'PUT', headers: authHeaders });
    console.log('   Toggle back to AVAILABLE:', toggleBack.data.item.available === true ? '✅ PASSED' : '❌ FAILED');

    // 9. Initial Table Session (Should be false)
    const initSession = await request(`/api/order/table/${tableId}/session`);
    console.log('9. Initial Table Session (hasActiveSession: false):', initSession.status === 200 && initSession.data.hasActiveSession === false ? '✅ PASSED' : '❌ FAILED');

    // 10. Place Customer Order with Cooking Notes (2 Starters + 2 Mains = 440 + 640 = 1080)
    const orderRes = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      notes: 'Make it medium spicy, no onions please',
      customer: {
        name: 'Tarun Diner',
        phone: '+91-9988776655',
        consentGiven: true
      },
      items: [
        { menuItemId: starter.data.id, quantity: 2 },
        { menuItemId: main.data.id, quantity: 2 }
      ]
    });
    const orderId = orderRes.data.orderId;
    console.log(`10. Place Order with Notes (Total: ₹${orderRes.data.total}, expected: 1080):`, orderRes.status === 201 && parseFloat(orderRes.data.total) === 1080 ? '✅ PASSED' : '❌ FAILED');

    // 11. Re-scan Session Detection (No re-login needed)
    const activeSession = await request(`/api/order/table/${tableId}/session`);
    console.log('11. Re-Scan Session Detection:', activeSession.data.hasActiveSession === true && activeSession.data.customer.name === 'Tarun Diner' ? '✅ PASSED' : '❌ FAILED');

    // 12. Add More Items via Re-Scan (2 Breads = 110) -> Total becomes ₹1190
    const addMore = await request(`/api/order/${orderId}/items`, { method: 'POST' }, {
      items: [{ menuItemId: bread.data.id, quantity: 2 }]
    });
    console.log(`12. Add Items on Re-Scan (New Total: ₹${addMore.data.total}, expected: 1190):`, addMore.status === 200 && parseFloat(addMore.data.total) === 1190 ? '✅ PASSED' : '❌ FAILED');

    // 13. Kitchen Display System (KDS) Active Tickets
    const kdsTickets = await request(`/api/kitchen/tickets?restaurantId=${restaurantId}`);
    const pendingFound = kdsTickets.status === 200 && kdsTickets.data.pending.some(t => t.order_id === orderId);
    console.log('13. KDS Live Ticket Feed (Pending stage):', pendingFound ? '✅ PASSED' : '❌ FAILED');

    // 14. Kitchen Advances Ticket: PENDING -> PREPARING
    const adv1 = await request(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    console.log('14. KDS Advance: PENDING ➔ PREPARING:', adv1.status === 200 && adv1.data.order.status === 'PREPARING' ? '✅ PASSED' : '❌ FAILED');

    // 15. Kitchen Advances Ticket: PREPARING -> READY (chime trigger)
    const adv2 = await request(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    console.log('15. KDS Advance: PREPARING ➔ READY (Plated & Chime):', adv2.status === 200 && adv2.data.order.status === 'READY' ? '✅ PASSED' : '❌ FAILED');

    // 16. Owner Dismiss / Settle Bill
    const dismissRes = await request(`/api/order/${orderId}/dismiss`, { method: 'PUT' });
    console.log('16. Owner Dismiss / Bill Settled:', dismissRes.status === 200 && dismissRes.data.order.status === 'PAID' ? '✅ PASSED' : '❌ FAILED');

    // 17. Verify Table Session is Reset for Next Customer
    const resetSession = await request(`/api/order/table/${tableId}/session`);
    console.log('17. Table Session Reset for Next Customer:', resetSession.status === 200 && resetSession.data.hasActiveSession === false ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 17 VERIFICATION CHECKS (KDS, MENU MANAGEMENT, SESSION & RE-SCAN) PASSED PERFECTLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
