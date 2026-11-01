// tests/api.test.js
process.env.NODE_ENV = 'test';
const request = require('supertest');
const { app } = require('../server');
const db = require('../db');

describe('Restaurant QR Backend - Full End-to-End Suite', () => {
  let adminToken;
  let restaurantId;
  let tableId;
  let tableNumber;
  let menuItemId;
  let testOrderId;

  beforeAll(async () => {
    // Authenticate admin
    const loginRes = await request(app)
      .post('/api/admin/login')
      .send({
        email: process.env.ADMIN_EMAIL || 'admin@example.com',
        password: process.env.ADMIN_PASS || 'supersecret'
      });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // Create unique test restaurant
    const restRes = await request(app)
      .post('/api/admin/restaurant')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Jest Test Bistro ' + Date.now(),
        owner_name: 'Tarun Tester',
        address: '101 Automated Way',
        phone: '+91-9000000000'
      });
    expect(restRes.status).toBe(201);
    restaurantId = restRes.body.id;

    // Configure 5% tax
    await request(app)
      .put(`/api/admin/restaurant/${restaurantId}/tax`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ taxPercentage: 5.0, currency: '₹' });

    // Create test table
    tableNumber = Math.floor(Math.random() * 80000) + 10000;
    const tableRes = await request(app)
      .post('/api/admin/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ number: tableNumber, restaurantId });
    expect(tableRes.status).toBe(201);
    tableId = tableRes.body.id;

    // Create test menu item (₹200)
    const dishRes = await request(app)
      .post('/api/admin/menu')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        restaurantId,
        name: 'Tandoori Platter',
        category: 'Starters',
        price: 200.00,
        available: true
      });
    expect(dishRes.status).toBe(201);
    menuItemId = dishRes.body.id;

    // Create promo coupon (10% OFF)
    await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        restaurantId,
        code: 'JEST10',
        discountType: 'PERCENTAGE',
        discountValue: 10.0,
        minOrderAmount: 100.0
      });
  });

  afterAll(async () => {
    // Close database pool connection cleanly
    await db.pool.end();
  });

  test('1. Health Check & Security Headers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('2. Public Menu & Category Grouping', async () => {
    const res = await request(app).get(`/api/menu/${restaurantId}?groupByCategory=true`);
    expect(res.status).toBe(200);
    expect(res.body.categories).toContain('Starters');
    expect(res.body.itemsByCategory['Starters'].length).toBeGreaterThanOrEqual(1);
  });

  test('3. Table QR Code Generation (PNG & SVG)', async () => {
    const pngRes = await request(app).get(`/api/qr/${tableId}`);
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers['content-type']).toBe('image/png');

    const svgRes = await request(app).get(`/api/qr/${tableId}?format=svg`);
    expect(svgRes.status).toBe(200);
    const svgContent = svgRes.text || (svgRes.body && svgRes.body.toString()) || '';
    expect(svgContent).toContain('<svg');
  });

  test('4. Bulk QR Generation for Restaurant Tables', async () => {
    const bulkRes = await request(app).get(`/api/qr/restaurant/${restaurantId}/bulk`);
    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.tables.length).toBeGreaterThanOrEqual(1);
    expect(bulkRes.body.tables[0].qrCodeDataUrl).toMatch(/^data:image\/png/);
  });

  test('5. Check Initial Table Session (Should be false)', async () => {
    const sessionRes = await request(app).get(`/api/order/table/${tableId}/session`);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.hasActiveSession).toBe(false);
  });

  test('6. Enforce GDPR Consent on Customer Creation', async () => {
    const badOrder = await request(app)
      .post('/api/order')
      .send({
        restaurantId,
        tableId,
        customer: { name: 'Consent Denied', phone: '+91-9111111111', consentGiven: false },
        items: [{ menuItemId, quantity: 1 }]
      });
    expect(badOrder.status).toBe(400);
    expect(badOrder.body.error).toMatch(/GDPR/i);
  });

  test('7. Place Valid Order with 5% GST Calculation', async () => {
    // 2 Tandoori Platters = 2 * 200 = ₹400 Subtotal. 5% GST = ₹20. Grand Total = ₹420
    const orderRes = await request(app)
      .post('/api/order')
      .send({
        restaurantId,
        tableId,
        notes: 'Extra green chutney please',
        customer: { name: 'Tarun Jest', phone: '+91-9222222222', consentGiven: true },
        items: [{ menuItemId, quantity: 2 }]
      });
    expect(orderRes.status).toBe(201);
    expect(parseFloat(orderRes.body.subtotal)).toBe(400);
    expect(parseFloat(orderRes.body.taxAmount)).toBe(20);
    expect(parseFloat(orderRes.body.total)).toBe(420);
    testOrderId = orderRes.body.orderId;
  });

  test('8. Re-Scan Table Session Detection (No re-login required)', async () => {
    const sessionRes = await request(app).get(`/api/order/table/${tableId}/session`);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.hasActiveSession).toBe(true);
    expect(sessionRes.body.customer.name).toBe('Tarun Jest');
    expect(parseFloat(sessionRes.body.total)).toBe(420);
  });

  test('9. Apply 10% Promo Coupon (JEST10)', async () => {
    // Subtotal: 400. 10% Discount: 40. Taxable: 360. 5% GST: 18. Grand Total: 378
    const couponRes = await request(app)
      .post(`/api/order/${testOrderId}/apply-coupon`)
      .send({ code: 'JEST10' });
    expect(couponRes.status).toBe(200);
    expect(parseFloat(couponRes.body.bill.discountAmount)).toBe(40);
    expect(parseFloat(couponRes.body.bill.taxAmount)).toBe(18);
    expect(parseFloat(couponRes.body.bill.grandTotal)).toBe(378);
  });

  test('10. Smart Table Bill Split 3-Ways', async () => {
    // 378 / 3 = ₹126.00 each
    const splitRes = await request(app).get(`/api/order/${testOrderId}/split?ways=3`);
    expect(splitRes.status).toBe(200);
    expect(splitRes.body.splitWays).toBe(3);
    expect(parseFloat(splitRes.body.perPersonAmount)).toBe(126);
  });

  test('11. Customer Calls Waiter from Table', async () => {
    const callRes = await request(app)
      .post(`/api/order/table/${tableId}/call-waiter`)
      .send({ requestType: 'WATER', note: 'Cold water bottle' });
    expect(callRes.status).toBe(201);
    expect(callRes.body.request.status).toBe('PENDING');
  });

  test('12. KDS Tickets Feed & Order Stage Advancement', async () => {
    const kdsRes = await request(app).get(`/api/kitchen/tickets?restaurantId=${restaurantId}`);
    expect(kdsRes.status).toBe(200);
    expect(kdsRes.body.pending.length).toBeGreaterThanOrEqual(1);

    // Advance PENDING -> PREPARING
    const adv1 = await request(app).put(`/api/kitchen/tickets/${testOrderId}/advance`);
    expect(adv1.status).toBe(200);
    expect(adv1.body.order.status).toBe('PREPARING');

    // Advance PREPARING -> READY
    const adv2 = await request(app).put(`/api/kitchen/tickets/${testOrderId}/advance`);
    expect(adv2.status).toBe(200);
    expect(adv2.body.order.status).toBe('READY');
  });

  test('13. Bill Settlement with UPI Payment Method', async () => {
    const dismissRes = await request(app)
      .put(`/api/order/${testOrderId}/dismiss`)
      .send({ paymentMethod: 'UPI' });
    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.order.status).toBe('PAID');
    expect(dismissRes.body.order.payment_method).toBe('UPI');
  });

  test('14. Customer Leaves 5-Star Feedback', async () => {
    const feedbackRes = await request(app)
      .post(`/api/order/${testOrderId}/feedback`)
      .send({ rating: 5, comments: 'Super fast order & excellent food!' });
    expect(feedbackRes.status).toBe(201);
    expect(feedbackRes.body.feedback.rating).toBe(5);
  });

  test('15. Accounting Sales Report CSV Download', async () => {
    const csvRes = await request(app)
      .get(`/api/admin/reports/sales/csv?restaurantId=${restaurantId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('Tarun Jest');
    expect(csvRes.text).toContain('UPI');
  });
});
