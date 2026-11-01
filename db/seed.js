// db/seed.js
const db = require('./index');

async function seed() {
  console.log('🌱 Starting Database Seeding for Royal Spice Bistro...');

  try {
    // 1. Check or Create Demo Restaurant
    let restaurantRes = await db.query(`SELECT id FROM restaurants WHERE name = 'Royal Spice Bistro' LIMIT 1`);
    let restaurantId;

    if (restaurantRes.rowCount === 0) {
      const restInsert = await db.query(
        `INSERT INTO restaurants (name, owner_name, address, phone, tax_percentage, currency)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          'Royal Spice Bistro',
          'Tarun Karthick',
          '742 Evergreen Promenade, City Center',
          '+91-9876543210',
          5.0,
          '₹'
        ]
      );
      restaurantId = restInsert.rows[0].id;
      console.log('✅ Created Restaurant: Royal Spice Bistro (ID:', restaurantId, ')');
    } else {
      restaurantId = restaurantRes.rows[0].id;
      console.log('ℹ️ Restaurant already exists (ID:', restaurantId, ')');
    }

    // 2. Seed 5 Tables (Tables 1 to 5)
    for (let num = 1; num <= 5; num++) {
      const tableCheck = await db.query(
        `SELECT id FROM tables WHERE restaurant_id = $1 AND number = $2`,
        [restaurantId, num]
      );
      if (tableCheck.rowCount === 0) {
        await db.query(
          `INSERT INTO tables (restaurant_id, number, qr_code_url)
           VALUES ($1, $2, $3)`,
          [restaurantId, num, `http://localhost:3000/order?tableNumber=${num}`]
        );
      }
    }
    console.log('✅ Seeded 5 Tables (Table 1 through 5)');

    // 3. Seed Menu Items across Starters, Main Course, Breads, Beverages, Desserts
    const menuItems = [
      // Starters
      { name: 'Paneer Tikka', category: 'Starters', price: 240.00, desc: 'Tandoor-charred cottage cheese with mint dip', photo: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500' },
      { name: 'Crispy Corn Salt & Pepper', category: 'Starters', price: 180.00, desc: 'Sweet golden corn tossed in oriental spices', photo: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=500' },
      { name: 'Chicken 65', category: 'Starters', price: 280.00, desc: 'Spicy, deep-fried chicken cubes tempered with curry leaves', photo: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?w=500' },

      // Main Course
      { name: 'Paneer Butter Masala', category: 'Main Course', price: 290.00, desc: 'Soft paneer cubes simmered in rich creamy tomato gravy', photo: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500' },
      { name: 'Butter Chicken', category: 'Main Course', price: 340.00, desc: 'Tender chicken pieces cooked in authentic makhani sauce', photo: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500' },
      { name: 'Dal Makhani', category: 'Main Course', price: 220.00, desc: 'Slow-cooked black lentils finished with fresh cream and butter', photo: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500' },

      // Breads
      { name: 'Butter Naan', category: 'Breads', price: 50.00, desc: 'Fluffy clay-oven flatbread brushed with butter', photo: 'https://images.unsplash.com/photo-1626074353765-517a681e40be?w=500' },
      { name: 'Garlic Naan', category: 'Breads', price: 65.00, desc: 'Topped with roasted garlic and coriander', photo: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500' },
      { name: 'Tandoori Roti', category: 'Breads', price: 30.00, desc: 'Whole wheat traditional clay-oven bread', photo: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=500' },

      // Beverages
      { name: 'Fresh Lime Soda', category: 'Beverages', price: 80.00, desc: 'Refreshing lime drink sweet & salted', photo: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500' },
      { name: 'Mango Lassi', category: 'Beverages', price: 120.00, desc: 'Thick yoghurt beverage blended with Alphonso mango pulp', photo: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=500' },

      // Desserts
      { name: 'Gulab Jamun (2 pcs)', category: 'Desserts', price: 90.00, desc: 'Warm milk-solid dumplings soaked in rose cardamom syrup', photo: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=500' },
      { name: 'Sizzling Chocolate Brownie', category: 'Desserts', price: 160.00, desc: 'Gooey walnut brownie served on a hot sizzler with vanilla ice cream', photo: 'https://images.unsplash.com/photo-1579954115545-a95591f28bfc?w=500' }
    ];

    for (const item of menuItems) {
      const itemCheck = await db.query(
        `SELECT id FROM menu_items WHERE restaurant_id = $1 AND name = $2`,
        [restaurantId, item.name]
      );
      if (itemCheck.rowCount === 0) {
        await db.query(
          `INSERT INTO menu_items (restaurant_id, name, description, category, price, photo_url, available)
           VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [restaurantId, item.name, item.desc, item.category, item.price, item.photo]
        );
      }
    }
    console.log(`✅ Seeded ${menuItems.length} Categorized Menu Items`);

    // 4. Seed Promotional Coupons
    const coupons = [
      { code: 'WELCOME10', type: 'PERCENTAGE', value: 10.0, min: 300.0, max: 150.0 },
      { code: 'FLAT50', type: 'FLAT', value: 50.0, min: 250.0, max: null }
    ];

    for (const c of coupons) {
      const cCheck = await db.query(
        `SELECT id FROM coupons WHERE restaurant_id = $1 AND code = $2`,
        [restaurantId, c.code]
      );
      if (cCheck.rowCount === 0) {
        await db.query(
          `INSERT INTO coupons (restaurant_id, code, discount_type, discount_value, min_order_amount, max_discount_amount)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [restaurantId, c.code, c.type, c.value, c.min, c.max]
        );
      }
    }
    console.log(`✅ Seeded ${coupons.length} Active Promo Coupons (WELCOME10, FLAT50)`);

    console.log('\n🎉 Database Seeding Completed Successfully!');
    console.log(`👉 Test the restaurant menu via: GET /api/menu/${restaurantId}?groupByCategory=true\n`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed with error:', err);
    process.exit(1);
  }
}

seed();

