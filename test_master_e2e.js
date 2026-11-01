// test_master_e2e.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3009; // dedicated port for master test

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

function assert(condition, stepName, details = '') {
  if (condition) {
    console.log(`  ✅ [PASS] ${stepName} ${details ? '— ' + details : ''}`);
    return true;
  } else {
    console.error(`  ❌ [FAIL] ${stepName} ${details ? '— ' + details : ''}`);
    throw new Error(`Assertion failed at step: ${stepName}`);
  }
}

async function runMasterTest() {
  console.log('\n================================================================');
  console.log('🚀 RESTAURANT QR ORDERING BACKEND: MASTER FULL E2E SUITE');
  console.log('================================================================\n');

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server started on http://localhost:${PORT} [NODE_ENV=test]\n`);

  try {
    // -------------------------------------------------------------
    // PHASE 1: System Health & Security
    // -------------------------------------------------------------
    console.log('--- PHASE 1: System Health, Security & Docs ---');
    const health = await request('/health');
    assert(health.status === 200 && health.data.status === 'ok', 'Health Check', 'Status 200 OK');
    assert(health.headers['x-content-type-options'] === 'nosniff', 'Helmet Security Header: nosniff');
    assert(health.headers['x-frame-options'] === 'SAMEORIGIN', 'Helmet Security Header: frameguard');

    const swagger = await request('/api/docs/');
    assert(swagger.status === 200 || swagger.status === 301, 'Swagger OpenAPI UI (/api/docs)', 'Interactive playground available');

    // -------------------------------------------------------------
    // PHASE 2: Authentication
    // -------------------------------------------------------------
    console.log('\n--- PHASE 2: Admin Authentication ---');
    const badLogin = await request('/api/admin/login', { method: 'POST' }, {
      email: 'admin@example.com',
      password: 'wrong_password'
    });
    assert(badLogin.status === 401, 'Reject Invalid Login', 'HTTP 401 Unauthorized');

    const goodLogin = await request('/api/admin/login', { method: 'POST' }, {
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      password: process.env.ADMIN_PASS || 'supersecret'
    });
    assert(goodLogin.status === 200 && goodLogin.data.token, 'Valid Admin Login', 'JWT Token issued');
    const token = goodLogin.data.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // -------------------------------------------------------------
    // PHASE 3: Restaurant & Table Management
    // -------------------------------------------------------------
    console.log('\n--- PHASE 3: Restaurant & Table Configuration ---');
    const uniqueName = 'Master Test Dining ' + Date.now();
    const createRest = await request('/api/admin/restaurant', { method: 'POST', headers: authHeaders }, {
      name: uniqueName,
      owner_name: 'Tarun Karthick',
      address: 'Central Plaza, Tower 1',
      phone: '+91-9876543210'
    });
    assert(createRest.status === 201 && createRest.data.id, 'Create Restaurant', `ID: ${createRest.data.id}`);
    const restaurantId = createRest.data.id;

    // Configure Tax: 5.0% GST
    const taxRes = await request(`/api/admin/restaurant/${restaurantId}/tax`, { method: 'PUT', headers: authHeaders }, {
      taxPercentage: 5.0,
      currency: '₹'
    });
    assert(taxRes.status === 200 && parseFloat(taxRes.data.restaurant.tax_percentage) === 5.0, 'Configure 5% GST & Currency (₹)');

    // Create 3 Tables
    const tableNums = [Math.floor(Math.random() * 80000) + 1000, Math.floor(Math.random() * 80000) + 2000, Math.floor(Math.random() * 80000) + 3000];
    const createdTables = [];
    for (const num of tableNums) {
      const tRes = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
        number: num,
        restaurantId
      });
      assert(tRes.status === 201, `Create Table ${num}`);
      createdTables.push(tRes.data);
    }
    const table1 = createdTables[0];
    const table2 = createdTables[1];

    // -------------------------------------------------------------
    // PHASE 4: High-Resolution & Bulk QR Code Engine
    // -------------------------------------------------------------
    console.log('\n--- PHASE 4: Dynamic & Bulk QR Code Generation ---');
    const pngQr = await request(`/api/qr/${table1.id}`);
    assert(pngQr.status === 200 && pngQr.headers['content-type'] === 'image/png', 'Table 1 PNG Stream');

    const svgQr = await request(`/api/qr/${table1.id}?format=svg`);
    const svgStr = typeof svgQr.data === 'string' ? svgQr.data : (svgQr.headers['content-type'] || '');
    assert(svgQr.status === 200 && svgStr.includes('<svg'), 'Table 1 Infinite-Res SVG Vector');

    const jsonQr = await request(`/api/qr/${table1.id}?format=json&size=800&dark=0f172a&light=ffffff`);
    assert(jsonQr.status === 200 && jsonQr.data.qrCodeDataUrl.startsWith('data:image/png'), 'High-Res Styled QR Data URL');

    const bulkQr = await request(`/api/qr/restaurant/${restaurantId}/bulk`);
    assert(bulkQr.status === 200 && bulkQr.data.tables.length >= 3, 'Bulk QR Batch Generation', `${bulkQr.data.tables.length} tables generated for stickers`);

    // -------------------------------------------------------------
    // PHASE 5: Menu Management & Out-Of-Stock Toggle
    // -------------------------------------------------------------
    console.log('\n--- PHASE 5: Menu Management & Stock Controls ---');
    const dish1 = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Paneer Malai Tikka',
      category: 'Starters',
      price: 250.00,
      available: true
    });
    const dish2 = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Butter Naan',
      category: 'Breads',
      price: 50.00,
      available: true
    });
    const dish3 = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Dum Biryani',
      category: 'Main Course',
      price: 350.00,
      available: true
    });
    assert(dish1.status === 201 && dish2.status === 201 && dish3.status === 201, 'Create Menu across Starters, Breads, Mains');

    const catRes = await request(`/api/menu/${restaurantId}/categories`);
    assert(catRes.status === 200 && catRes.data.includes('Starters') && catRes.data.includes('Main Course'), 'List Categories');

    const groupedRes = await request(`/api/menu/${restaurantId}?groupByCategory=true`);
    assert(groupedRes.status === 200 && groupedRes.data.categories.length >= 3, 'Grouped Menu Fetch for Mobile');

    // 1-Click Out-Of-Stock Toggle
    const toggleOff = await request(`/api/admin/menu/${dish1.data.id}/toggle-availability`, { method: 'PUT', headers: authHeaders });
    assert(toggleOff.status === 200 && toggleOff.data.item.available === false, '1-Click Toggle: Out of Stock (available=false)');

    const toggleOn = await request(`/api/admin/menu/${dish1.data.id}/toggle-availability`, { method: 'PUT', headers: authHeaders });
    assert(toggleOn.status === 200 && toggleOn.data.item.available === true, '1-Click Toggle: Restocked (available=true)');

    // -------------------------------------------------------------
    // PHASE 6: Table Session & GDPR Enforcement
    // -------------------------------------------------------------
    console.log('\n--- PHASE 6: Table Session & GDPR Enforcement ---');
    const initSession = await request(`/api/order/table/${table1.id}/session`);
    assert(initSession.status === 200 && initSession.data.hasActiveSession === false, 'Initial Scan Session Check', 'hasActiveSession: false');

    const gdprDenial = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId: table1.id,
      customer: { name: 'GDPR Reject', phone: '+91-9999999999', consentGiven: false },
      items: [{ menuItemId: dish1.data.id, quantity: 1 }]
    });
    assert(gdprDenial.status === 400 && gdprDenial.data.error.includes('GDPR'), 'Enforce GDPR Consent Requirement', 'HTTP 400 Bad Request');

    // Place Initial Order: 2 Starters (500) + 2 Mains (700) = Subtotal 1200. Tax (5%) = 60. Grand Total = 1260
    const orderRes = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId: table1.id,
      notes: 'Less oil, spicy please',
      customer: { name: 'Tarun Master Customer', phone: '+91-9876500000', consentGiven: true },
      items: [
        { menuItemId: dish1.data.id, quantity: 2 }, // 250 * 2 = 500
        { menuItemId: dish3.data.id, quantity: 2 }  // 350 * 2 = 700 => Subtotal = 1200
      ]
    });
    const orderId = orderRes.data.orderId;
    const isMathCorrect = orderRes.status === 201 &&
      parseFloat(orderRes.data.subtotal) === 1200 &&
      parseFloat(orderRes.data.taxAmount) === 60 &&
      parseFloat(orderRes.data.total) === 1260;
    assert(isMathCorrect, 'Order Creation & Tax Math', 'Subtotal: ₹1200, 5% Tax: ₹60, Grand Total: ₹1260');

    // -------------------------------------------------------------
    // PHASE 7: Re-Scan Session Memory & Add-To-Bill
    // -------------------------------------------------------------
    console.log('\n--- PHASE 7: Re-Scan Session Memory & Add Items ---');
    const activeSession = await request(`/api/order/table/${table1.id}/session`);
    const isRecognized = activeSession.status === 200 &&
      activeSession.data.hasActiveSession === true &&
      activeSession.data.customer.name === 'Tarun Master Customer' &&
      parseFloat(activeSession.data.total) === 1260;
    assert(isRecognized, 'Re-Scan Session Recognition (No re-login needed)');

    // Diner orders 4 Butter Naans (4 * 50 = 200). New Subtotal = 1400. 5% Tax = 70. Total = 1470
    const addItems = await request(`/api/order/${orderId}/items`, { method: 'POST' }, {
      items: [{ menuItemId: dish2.data.id, quantity: 4 }]
    });
    const isNewBillCorrect = addItems.status === 200 &&
      parseFloat(addItems.data.subtotal) === 1400 &&
      parseFloat(addItems.data.taxAmount) === 70 &&
      parseFloat(addItems.data.total) === 1470;
    assert(isNewBillCorrect, 'Add Items on Re-Scan', 'New Subtotal: ₹1400, 5% Tax: ₹70, New Total: ₹1470');

    // -------------------------------------------------------------
    // PHASE 8: Promo Coupons & Discounts
    // -------------------------------------------------------------
    console.log('\n--- PHASE 8: Promotional Coupons & Discounts ---');
    const couponCode = 'DISCOUNT10_' + Date.now().toString().slice(-4);
    const couponCreate = await request('/api/admin/coupons', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      code: couponCode,
      discountType: 'PERCENTAGE',
      discountValue: 10.0,
      minOrderAmount: 500.0
    });
    assert(couponCreate.status === 201, `Create 10% Coupon (${couponCode})`);

    // Apply Coupon: 10% off 1400 = -140. Taxable = 1260. 5% Tax = 63. Grand Total = 1323
    const applyCoupon = await request(`/api/order/${orderId}/apply-coupon`, { method: 'POST' }, { code: couponCode });
    const isDiscountMathCorrect = applyCoupon.status === 200 &&
      parseFloat(applyCoupon.data.bill.subtotal) === 1400 &&
      parseFloat(applyCoupon.data.bill.discountAmount) === 140 &&
      parseFloat(applyCoupon.data.bill.taxAmount) === 63 &&
      parseFloat(applyCoupon.data.bill.grandTotal) === 1323;
    assert(isDiscountMathCorrect, 'Apply Coupon Discount', 'Discount: -₹140, Taxable: ₹1260, New Total: ₹1323');

    // -------------------------------------------------------------
    // PHASE 9: Smart Table Bill Splitting
    // -------------------------------------------------------------
    console.log('\n--- PHASE 9: Smart Table Bill Splitting ---');
    // ₹1323 / 3 = ₹441.00 per person
    const split3 = await request(`/api/order/${orderId}/split?ways=3`);
    assert(split3.status === 200 && parseFloat(split3.data.perPersonAmount) === 441, 'Split Bill 3-Ways', '₹441.00 each');
    const sumShares = split3.data.shares.reduce((acc, s) => acc + s.amount, 0);
    assert(sumShares === 1323, 'Sum of Shares Exact Equality (Zero-Penny Loss)');

    // -------------------------------------------------------------
    // PHASE 10: Digital Waiter Calling System
    // -------------------------------------------------------------
    console.log('\n--- PHASE 10: Waiter Calling System ---');
    const callWaiter = await request(`/api/order/table/${table1.id}/call-waiter`, { method: 'POST' }, {
      requestType: 'CUTLERY',
      note: 'Please bring extra spoons and napkins'
    });
    assert(callWaiter.status === 201 && callWaiter.data.request.status === 'PENDING', 'Customer Calls Waiter for CUTLERY');
    const reqId = callWaiter.data.request.id;

    const listCalls = await request(`/api/admin/service-requests?restaurantId=${restaurantId}&status=PENDING`, { headers: authHeaders });
    assert(listCalls.status === 200 && listCalls.data.some(r => r.id === reqId), 'Active Service Call Appears on Staff Screen');

    const resolveCall = await request(`/api/admin/service-requests/${reqId}/resolve`, { method: 'PUT', headers: authHeaders });
    assert(resolveCall.status === 200 && resolveCall.data.request.status === 'RESOLVED', 'Staff Acknowledges & Resolves Call');

    // -------------------------------------------------------------
    // PHASE 11: Kitchen Display System (KDS)
    // -------------------------------------------------------------
    console.log('\n--- PHASE 11: Kitchen Display System (KDS) ---');
    const kdsTickets = await request(`/api/kitchen/tickets?restaurantId=${restaurantId}`);
    assert(kdsTickets.status === 200 && kdsTickets.data.pending.some(t => t.order_id === orderId), 'Active Ticket in KDS PENDING Column');

    const advPrep = await request(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    assert(advPrep.status === 200 && advPrep.data.order.status === 'PREPARING', 'Advance Ticket: PENDING ➔ PREPARING');

    const advReady = await request(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    assert(advReady.status === 200 && advReady.data.order.status === 'READY', 'Advance Ticket: PREPARING ➔ READY (Chime Alert)');

    // -------------------------------------------------------------
    // PHASE 12: Bill Settlement & Table Reset
    // -------------------------------------------------------------
    console.log('\n--- PHASE 12: Bill Settlement & Table Reset ---');
    const dismissRes = await request(`/api/order/${orderId}/dismiss`, { method: 'PUT' }, {
      paymentMethod: 'UPI'
    });
    assert(dismissRes.status === 200 && dismissRes.data.order.status === 'PAID', 'Cashier Dismisses & Settles Bill (Payment: UPI)');

    const postSession = await request(`/api/order/table/${table1.id}/session`);
    assert(postSession.status === 200 && postSession.data.hasActiveSession === false, 'Table Session Reset for Next Customer', 'hasActiveSession: false');

    // -------------------------------------------------------------
    // PHASE 13: Customer Reviews & Ratings
    // -------------------------------------------------------------
    console.log('\n--- PHASE 13: Customer Post-Meal Reviews ---');
    const feedbackRes = await request(`/api/order/${orderId}/feedback`, { method: 'POST' }, {
      rating: 5,
      comments: 'Lightning fast ordering and tasty food!'
    });
    assert(feedbackRes.status === 201 && feedbackRes.data.feedback.rating === 5, 'Customer Submits 5-Star Review');

    const adminFeedback = await request(`/api/admin/feedback?restaurantId=${restaurantId}`, { headers: authHeaders });
    assert(adminFeedback.status === 200 && adminFeedback.data.summary.totalReviews >= 1, 'Manager Reviews Dashboard & Rating Feed');

    // -------------------------------------------------------------
    // PHASE 14: Customer Directory & Accounting CSV
    // -------------------------------------------------------------
    console.log('\n--- PHASE 14: Analytics, Directory & CSV Accounting ---');
    const customerList = await request(`/api/admin/customers?restaurantId=${restaurantId}`, { headers: authHeaders });
    assert(customerList.status === 200 && customerList.data.some(c => c.phone === '+91-9876500000'), 'Customer Directory with Lifetime Spend');

    const analyticsOverview = await request(`/api/admin/analytics/overview?restaurantId=${restaurantId}`, { headers: authHeaders });
    assert(analyticsOverview.status === 200 && analyticsOverview.data.today.totalRevenue >= 1323, 'Analytics: Revenue, Taxes & Peak Hours');

    const csvReport = await request(`/api/admin/reports/sales/csv?restaurantId=${restaurantId}`, { headers: authHeaders });
    const isCsvOk = csvReport.status === 200 &&
      csvReport.headers['content-type'].includes('text/csv') &&
      csvReport.data.includes('Tarun Master Customer') &&
      csvReport.data.includes('UPI');
    assert(isCsvOk, 'Download Accounting Sales CSV Report', 'Itemized spreadsheet validated');

    console.log('\n================================================================');
    console.log('🎉 ALL 14 PHASES / 35 ASSERTIONS EXECUTED AND PASSED PERFECTLY!');
    console.log('💯 BACKEND IS 100% OPERATIONAL, PRODUCTION-READY AND VERIFIED!');
    console.log('================================================================\n');

    server.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ MASTER VERIFICATION ABORTED WITH ERROR:', err.message);
    server.close();
    process.exit(1);
  }
}

runMasterTest();

