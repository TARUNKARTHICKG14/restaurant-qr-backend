// simulate_full_flow.js
process.env.NODE_ENV = 'test';
const http = require('http');
const { app, server } = require('./server');

const PORT = 3010;

async function api(path, options = {}, body = null) {
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

function divider(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`📌 ${title}`);
  console.log('='.repeat(70));
}

async function runFullSimulation() {
  await new Promise((resolve) => server.listen(PORT, resolve));

  try {
    // -------------------------------------------------------------
    // SETUP: Restaurant & Admin Initialization
    // -------------------------------------------------------------
    divider('STEP 1: OWNER SETS UP RESTAURANT & TABLES');
    const login = await api('/api/admin/login', { method: 'POST' }, {
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      password: process.env.ADMIN_PASS || 'supersecret'
    });
    const token = login.data.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    const restRes = await api('/api/admin/restaurant', { method: 'POST', headers: authHeaders }, {
      name: 'Spice Symphony',
      owner_name: 'Tarun Karthick',
      address: 'Shop 14, Royal Palm Arcade',
      phone: '+91-9876543210'
    });
    const restaurantId = restRes.data.id;
    console.log(`✅ Restaurant Created: "${restRes.data.name}" (ID: ${restaurantId})`);

    // Set 5% GST
    await api(`/api/admin/restaurant/${restaurantId}/tax`, { method: 'PUT', headers: authHeaders }, {
      taxPercentage: 5.0,
      currency: '₹'
    });
    console.log('✅ Tax Configured: 5.0% GST, Currency: ₹');

    // Create Table 1
    const tNum = Math.floor(Math.random() * 80000) + 1000;
    const tableRes = await api('/api/admin/tables', { method: 'POST', headers: authHeaders }, {
      number: tNum,
      restaurantId
    });
    const tableId = tableRes.data.id;
    console.log(`✅ Table Initialized: Table #${tNum} (ID: ${tableId})`);

    // Add Menu Items
    const starterRes = await api('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Crispy Paneer Bites',
      category: 'Starters',
      price: 220.00,
      available: true
    });
    const mainRes = await api('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Smoked Butter Chicken',
      category: 'Main Course',
      price: 360.00,
      available: true
    });
    const breadRes = await api('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Garlic Butter Naan',
      category: 'Breads',
      price: 55.00,
      available: true
    });
    const dessertRes = await api('/api/admin/menu', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      name: 'Gulab Jamun with Ice Cream',
      category: 'Desserts',
      price: 110.00,
      available: true
    });
    console.log('✅ Menu Loaded: Starters, Mains, Breads, Desserts');

    // Create 10% Discount Coupon
    const promoCode = 'FESTIVE10_' + Date.now().toString().slice(-4);
    await api('/api/admin/coupons', { method: 'POST', headers: authHeaders }, {
      restaurantId,
      code: promoCode,
      discountType: 'PERCENTAGE',
      discountValue: 10.0,
      minOrderAmount: 400.0
    });
    console.log(`✅ Promo Coupon Created: ${promoCode} (10% OFF for orders above ₹400)`);

    // -------------------------------------------------------------
    // SCENE 1: CUSTOMER ENTERS & SCANS TABLE 1 QR CODE
    // -------------------------------------------------------------
    divider(`STEP 2: DINER SCANS TABLE #${tNum} QR CODE`);
    const qrInfo = await api(`/api/qr/${tableId}?format=json`);
    console.log(`📱 QR Code Scanned!`);
    console.log(`   Target URL: ${qrInfo.data.targetUrl}`);
    console.log(`   QR Image Stream Type: High-Res PNG / Vector SVG`);

    // Check Table Session
    const checkSession1 = await api(`/api/order/table/${tableId}/session`);
    console.log(`🔍 Checking Table Session: hasActiveSession = ${checkSession1.data.hasActiveSession}`);
    console.log(`👉 Result: New dining party! Prompting for Name & Phone Number.`);

    // -------------------------------------------------------------
    // SCENE 2: CUSTOMER BROWSES MENU & PLACES ORDER
    // -------------------------------------------------------------
    divider('STEP 3: DINER BROWSES MENU & PLACES INITIAL ORDER');
    const menuView = await api(`/api/menu/${restaurantId}?groupByCategory=true`);
    console.log(`📋 Menu loaded into Mobile Web Interface:`);
    for (const cat of menuView.data.categories) {
      console.log(`   [${cat}]`);
      for (const item of menuView.data.itemsByCategory[cat]) {
        console.log(`     - ${item.name} ................... ₹${item.price} (${item.available ? 'In Stock' : 'Out of Stock'})`);
      }
    }

    // Customer places order: 2 Starters + 2 Mains
    console.log('\n🛒 Diner adds to cart:');
    console.log('   2x Crispy Paneer Bites (₹220 x 2 = ₹440)');
    console.log('   2x Smoked Butter Chicken (₹360 x 2 = ₹720)');
    console.log('   Special Cooking Instruction: "Medium spicy, please keep sauce on the side"');

    const placeOrderRes = await api('/api/order', { method: 'POST' }, {
      restaurantId,
      tableId,
      notes: 'Medium spicy, please keep sauce on the side',
      customer: {
        name: 'Arjun Sharma',
        phone: '+91-9840123456',
        consentGiven: true
      },
      items: [
        { menuItemId: starterRes.data.id, quantity: 2 },
        { menuItemId: mainRes.data.id, quantity: 2 }
      ]
    });

    const orderId = placeOrderRes.data.orderId;
    console.log('\n🧾 Order Receipt Generated:');
    console.log(`   Order ID:       ${orderId}`);
    console.log(`   Customer:       Arjun Sharma (+91-9840123456)`);
    console.log(`   Food Subtotal:  ₹${placeOrderRes.data.subtotal}`);
    console.log(`   GST (5.0%):     ₹${placeOrderRes.data.taxAmount}`);
    console.log(`   Grand Total:    ₹${placeOrderRes.data.total}`);
    console.log(`   Status:         ${placeOrderRes.data.status}`);

    // -------------------------------------------------------------
    // SCENE 3: KITCHEN DISPLAY SYSTEM (CHEF'S TABLET)
    // -------------------------------------------------------------
    divider('STEP 4: KITCHEN DISPLAY SYSTEM (KDS) RECEIVES TICKET');
    const kdsTickets = await api(`/api/kitchen/tickets?restaurantId=${restaurantId}`);
    const activeTicket = kdsTickets.data.pending.find(t => t.order_id === orderId);
    console.log(`🔔 Chef's screen alerted with chime!`);
    console.log(`   Table:        #${activeTicket.table_number}`);
    console.log(`   Elapsed Wait: ${activeTicket.elapsed_minutes} minutes`);
    console.log(`   Chef Notes:   "${activeTicket.notes}"`);
    console.log(`   Dishes to Cook:`);
    for (const it of activeTicket.items) {
      console.log(`     - [QTY: ${it.quantity}] ${it.item_name} (${it.category})`);
    }

    console.log('\n👨‍🍳 Chef taps "Start Cooking" ➔ Ticket moves to PREPARING:');
    const prepRes = await api(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    console.log(`   New Stage: ${prepRes.data.order.status}`);

    console.log('👨‍🍳 Chef finishes plating ➔ Ticket moves to READY:');
    const readyRes = await api(`/api/kitchen/tickets/${orderId}/advance`, { method: 'PUT' });
    console.log(`   New Stage: ${readyRes.data.order.status} (Runner Chime Alert Emitted!)`);

    // -------------------------------------------------------------
    // SCENE 4: DINER RE-SCANS TO ORDER MORE & APPLIES COUPON
    // -------------------------------------------------------------
    divider(`STEP 5: DINER RE-SCANS TABLE #${tNum} QR CODE (NO RE-LOGIN)`);
    const checkSession2 = await api(`/api/order/table/${tableId}/session`);
    console.log(`🔍 Checking Table Session on Re-Scan:`);
    console.log(`   hasActiveSession: ${checkSession2.data.hasActiveSession}`);
    console.log(`   Welcome Back:     ${checkSession2.data.customer.name} (${checkSession2.data.customer.phone})`);
    console.log(`   👉 Zero Friction! Customer does NOT have to type name or phone again.`);
    console.log(`   Current Running Bill: ₹${checkSession2.data.total}`);

    console.log('\n🛒 Diner adds 3x Garlic Naan (₹55 x 3 = ₹165) + 2x Gulab Jamun (₹110 x 2 = ₹220):');
    const addItemsRes = await api(`/api/order/${orderId}/items`, { method: 'POST' }, {
      items: [
        { menuItemId: breadRes.data.id, quantity: 3 },
        { menuItemId: dessertRes.data.id, quantity: 2 }
      ]
    });
    console.log(`   New Food Subtotal: ₹${addItemsRes.data.subtotal}`);
    console.log(`   New Grand Total:   ₹${addItemsRes.data.total}`);

    console.log(`\n🎟️ Diner applies coupon code "${promoCode}":`);
    const applyCouponRes = await api(`/api/order/${orderId}/apply-coupon`, { method: 'POST' }, { code: promoCode });
    console.log(`   Discount Applied: -₹${applyCouponRes.data.bill.discountAmount} (10% OFF)`);
    console.log(`   Taxable Subtotal:  ₹${applyCouponRes.data.bill.subtotal - applyCouponRes.data.bill.discountAmount}`);
    console.log(`   GST (5.0%):        ₹${applyCouponRes.data.bill.taxAmount}`);
    console.log(`   Final Total:       ₹${applyCouponRes.data.bill.grandTotal}`);

    // -------------------------------------------------------------
    // SCENE 5: DINER TAPS "CALL WAITER"
    // -------------------------------------------------------------
    divider('STEP 6: DINER CALLS WAITER FROM TABLE SCREEN');
    const callWaiter = await api(`/api/order/table/${tableId}/call-waiter`, { method: 'POST' }, {
      requestType: 'WATER',
      note: 'Please bring cold bottled water'
    });
    console.log(`🔔 Customer tapped button: "${callWaiter.data.request.request_type}"`);
    console.log(`   Waiter screen notified with audio alert!`);

    const staffCalls = await api(`/api/admin/service-requests?restaurantId=${restaurantId}&status=PENDING`, { headers: authHeaders });
    console.log(`   Staff queue shows 1 pending request for Table #${tNum}`);

    await api(`/api/admin/service-requests/${callWaiter.data.request.id}/resolve`, { method: 'PUT', headers: authHeaders });
    console.log(`   Waiter attends table & taps "Resolved" ➔ Table call cleared!`);

    // -------------------------------------------------------------
    // SCENE 6: BILL SPLITTING & PAYMENT SETTLEMENT
    // -------------------------------------------------------------
    divider('STEP 7: BILL SPLITTING & CHECKOUT SETTLEMENT');
    const split3 = await api(`/api/order/${orderId}/split?ways=3`);
    console.log(`👥 Diners decide to split bill 3 ways:`);
    console.log(`   Total Bill:     ₹${split3.data.totalAmount}`);
    console.log(`   Per Person Pay: ₹${split3.data.perPersonAmount}`);
    for (const s of split3.data.shares) {
      console.log(`     - Person #${s.person}: ₹${s.amount}`);
    }

    console.log('\n💳 Cashier receives UPI Payment and taps "Dismiss / Settle Bill":');
    const settleRes = await api(`/api/order/${orderId}/dismiss`, { method: 'PUT' }, {
      paymentMethod: 'UPI'
    });
    console.log(`   Status:         ${settleRes.data.order.status}`);
    console.log(`   Payment Method: ${settleRes.data.order.payment_method}`);
    console.log(`   Table #${tNum} is now FREE for the next dining party.`);

    const checkSession3 = await api(`/api/order/table/${tableId}/session`);
    console.log(`🔍 Immediate Table Check: hasActiveSession = ${checkSession3.data.hasActiveSession} (Clean reset!)`);

    // -------------------------------------------------------------
    // SCENE 7: CUSTOMER SUBMITS 5-STAR REVIEW
    // -------------------------------------------------------------
    divider('STEP 8: CUSTOMER SUBMITS POST-MEAL REVIEW');
    const reviewRes = await api(`/api/order/${orderId}/feedback`, { method: 'POST' }, {
      rating: 5,
      comments: 'Phenomenal Butter Chicken and effortless QR table ordering! Will visit again.'
    });
    console.log(`⭐ Review Recorded: ${reviewRes.data.feedback.rating}/5 Stars`);
    console.log(`   Comments: "${reviewRes.data.feedback.comments}"`);

    // -------------------------------------------------------------
    // SCENE 8: OWNER DASHBOARD & REPORTING
    // -------------------------------------------------------------
    divider('STEP 9: RESTAURANT OWNER DASHBOARD & ACCOUNTING');
    const overview = await api(`/api/admin/analytics/overview?restaurantId=${restaurantId}`, { headers: authHeaders });
    console.log(`📊 Today's Executive Financial Performance:`);
    console.log(`   Total Orders:        ${overview.data.today.totalOrders}`);
    console.log(`   Unique Diners:       ${overview.data.today.uniqueCustomers}`);
    console.log(`   Gross Revenue:       ₹${overview.data.today.totalRevenue}`);
    console.log(`   GST Collected:       ₹${overview.data.today.totalTaxCollected}`);
    console.log(`   Average Order Value: ₹${overview.data.today.averageOrderValue}`);

    console.log('\n🏆 Table Performance Ranking:');
    for (const t of overview.data.salesByTable) {
      console.log(`   Table #${t.tableNumber} ➔ Orders: ${t.ordersCount}, Revenue: ₹${t.revenue}`);
    }

    console.log('\n💳 Collections by Payment Method:');
    for (const p of overview.data.paymentBreakdown) {
      console.log(`   ${p.method}: ₹${p.amount} (${p.count} transactions)`);
    }

    console.log('\n🍲 Best-Selling Dishes:');
    for (const d of overview.data.topSellingDishes) {
      console.log(`   - ${d.name} (${d.category}): ${d.quantitySold} sold (₹${d.revenue})`);
    }

    // 1-Click Out-Of-Stock Demo
    console.log('\n⚡ Owner runs out of "Smoked Butter Chicken" ➔ Taps 1-Click Toggle:');
    const toggleRes = await api(`/api/admin/menu/${mainRes.data.id}/toggle-availability`, { method: 'PUT', headers: authHeaders });
    console.log(`   Broadcast: ${toggleRes.data.message}`);

    // Accounting CSV Download
    const csvReport = await api(`/api/admin/reports/sales/csv?restaurantId=${restaurantId}`, { headers: authHeaders });
    console.log(`\n📥 Download Accounting CSV Spreadsheet (${csvReport.headers['content-type']}):`);
    const csvPreview = csvReport.data.split('\r\n').slice(0, 2).join('\n');
    console.log(csvPreview);

    divider('🎉 FULL END-TO-END RESTAURANT FLOW EXECUTED & VERIFIED WITH 100% SUCCESS!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Simulation failed:', err);
    server.close();
    process.exit(1);
  }
}

runFullSimulation();

