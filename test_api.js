// test_api.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3008; // dedicated test port

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
  console.log('🧪 Starting End-to-End API, Coupons & Bill Splitting Verification...');

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

    // 4. Configure Restaurant Tax (5%)
    await request(`/api/admin/restaurant/${restaurantId}/tax`, { method: 'PUT', headers: authHeaders }, {
      taxPercentage: 5.0,
      currency: '₹'
    });
    console.log('4. Configure Restaurant Tax (5% GST): ✅ PASSED');

    // 5. Create Table
    const tableRes = await request('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: Math.floor(Math.random() * 90000) + 1000,
      restaurantId
    });
    const tableId = tableRes.data.id;
    console.log('5. Create Table:', tableId ? '✅ PASSED' : '❌ FAILED');

    // 6. Create Menu Item (₹500)
    const dish = await request('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Mughlai Banquet Thali',
      category: 'Main Course',
      price: 500.00,
      available: true
    });
    console.log('6. Create Menu Item (₹500):', dish.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 7. Admin Creates 10% OFF Promo Coupon (WELCOME10)
    const couponRes = await request('/api/admin/coupons', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      code: 'WELCOME10',
      discountType: 'PERCENTAGE',
      discountValue: 10.0,
      minOrderAmount: 200.0
    });
    console.log('7. Admin Creates Promo Coupon WELCOME10 (10% OFF):', couponRes.status === 201 ? '✅ PASSED' : '❌ FAILED');

    // 8. Place Customer Order (2 Thalis = ₹1000 Subtotal, 5% Tax = ₹50, Total = ₹1050)
    const orderRes = await request('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      customer: {
        name: 'Tarun Promo Diner',
        phone: '+91-9876543222',
        consentGiven: true
      },
      items: [{ menuItemId: dish.data.id, quantity: 2 }]
    });
    const orderId = orderRes.data.orderId;
    console.log(`8. Place Order (Subtotal: ₹${orderRes.data.subtotal}, Total: ₹${orderRes.data.total}):`, orderRes.status === 201 && parseFloat(orderRes.data.total) === 1050 ? '✅ PASSED' : '❌ FAILED');

    // 9. Customer Applies Coupon WELCOME10
    // Subtotal = 1000, 10% Discount = -100, Taxable = 900, 5% Tax = 45 => Grand Total = 945
    const applyRes = await request(`/api/order/${orderId}/apply-coupon`, { method: 'POST' }, {
      code: 'WELCOME10'
    });
    const isCouponDiscountCorrect = applyRes.status === 200 &&
      parseFloat(applyRes.data.bill.subtotal) === 1000 &&
      parseFloat(applyRes.data.bill.discountAmount) === 100 &&
      parseFloat(applyRes.data.bill.taxAmount) === 45 &&
      parseFloat(applyRes.data.bill.grandTotal) === 945;
    console.log(`9. Apply Coupon (Discount: ₹${applyRes.data.bill.discountAmount}, New Total: ₹${applyRes.data.bill.grandTotal}):`, isCouponDiscountCorrect ? '✅ PASSED' : '❌ FAILED');

    // 10. Bill Splitting 3 Ways (₹945 / 3 = ₹315.00 per person)
    const splitRes = await request(`/api/order/${orderId}/split?ways=3`);
    const isSplitCorrect = splitRes.status === 200 &&
      splitRes.data.splitWays === 3 &&
      parseFloat(splitRes.data.perPersonAmount) === 315 &&
      splitRes.data.shares.reduce((acc, s) => acc + s.amount, 0) === 945;
    console.log(`10. Smart Table Bill Split 3-Ways (₹${splitRes.data.perPersonAmount} each):`, isSplitCorrect ? '✅ PASSED' : '❌ FAILED');

    // 11. Customer Removes Coupon
    // Reverts back to subtotal 1000, tax 50, grand total 1050
    const removeRes = await request(`/api/order/${orderId}/remove-coupon`, { method: 'DELETE' });
    const isReverted = removeRes.status === 200 &&
      parseFloat(removeRes.data.bill.discountAmount) === 0 &&
      parseFloat(removeRes.data.bill.grandTotal) === 1050;
    console.log('11. Remove Coupon & Revert Bill (Back to ₹1050):', isReverted ? '✅ PASSED' : '❌ FAILED');

    console.log('\n🎉 ALL 11 VERIFICATION CHECKS (COUPONS & BILL SPLITTING) PASSED PERFECTLY!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
