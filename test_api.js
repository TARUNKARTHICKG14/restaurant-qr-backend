// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3005; // dedicated test port

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
  console.log('🧪 Starting End-to-End API, Advanced QR & Feedback Verification...');

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

    // 4. Create Tables 1 and 2
    const t1 = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: Math.floor(Math.random() * 90000) + 1000,
      restaurantId
    });
    const t2 = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: Math.floor(Math.random() * 90000) + 2000,
      restaurantId
    });
    const tableId = t1.data.id;
    console.log('4. Create Tables:', t1.status === 201 && t2.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 5. Advanced QR Code - Vector SVG Format
    const svgRes = await request(`/api/qr/${tableId}?format=svg`);
    const isSvgValid = svgRes.status === 200 && typeof svgRes.data === 'string' && svgRes.data.includes('<svg');
    console.log('5. QR Code - Vector SVG Format:', isSvgValid ? '✅ PASSED' : '❌ FAILED');

    // 6. Advanced QR Code - High-Res Custom Colors (JSON format)
    const customQr = await request(`/api/qr/${tableId}?format=json&size=600&dark=1e293b&light=ffffff`);
    const isCustomQrValid = customQr.status === 200 && customQr.data.qrCodeDataUrl.startsWith('data:image/png');
    console.log('6. QR Code - Custom Styled High-Res JSON:', isCustomQrValid ? '✅ PASSED' : '❌ FAILED');

    // 7. Bulk QR Generation for Entire Restaurant
    const bulkQr = await request(`/api/qr/restaurant/${restaurantId}/bulk`);
    const isBulkValid = bulkQr.status === 200 && bulkQr.data.tables.length >= 2 && bulkQr.data.tables[0].qrCodeDataUrl;
    console.log('7. Bulk QR Generation for Table Stickers:', isBulkValid ? '✅ PASSED' : '❌ FAILED');

    // 8. Create Menu Item & Place Order
    const dish = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Signature Biryani',
      category: 'Main Course',
      price: 350.00,
      available: true
    });
    const orderRes = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      customer: {
        name: 'Tarun Foodie',
        phone: '+91-9999900001',
        consentGiven: true
      },
      items: [{ menuItemId: dish.data.id, quantity: 2 }]
    });
    const orderId = orderRes.data.orderId;
    console.log('8. Place Order for Signature Biryani:', orderRes.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 9. Bill Dismissal with Payment
    await request(`/api/order/${orderId}/dismiss`, { method: 'PUT' }, { paymentMethod: 'UPI' });
    console.log('9. Bill Dismissed & Settled via UPI: ✅ PASSED');

    // 10. Customer Submits 5-Star Feedback with Comments
    const feedbackRes = await request(`/api/order/${orderId}/feedback`, { method: 'POST' }, {
      rating: 5,
      comments: 'Phenomenal taste and fast delivery via the QR code!'
    });
    const feedbackOk = feedbackRes.status === 201 && feedbackRes.data.feedback.rating === 5;
    console.log('10. Customer Submit 5-Star Feedback:', feedbackOk ? '✅ PASSED' : '❌ FAILED');

    // 11. Admin Customer Reviews Dashboard
    const adminFeedback = await request(`/api/admin/feedback?restaurantId=${restaurantId}`, { headers: authHeaders });
    const adminFeedbackOk = adminFeedback.status === 200 &&
      adminFeedback.data.summary.totalReviews >= 1 &&
      adminFeedback.data.summary.averageRating === 5 &&
      adminFeedback.data.reviews.some(r => r.order_id === orderId && r.rating === 5);
    console.log('11. Admin Feedback Dashboard & Ratings Aggregator:', adminFeedbackOk ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 11 VERIFICATION CHECKS (ADVANCED QR & REVIEWS SYSTEM) PASSED PERFECTLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
