// Illustrative sample data for UI evaluation only; not a database feed.
    const bluePlateSampleData = {
      currentRole: 'ADMIN', // 'ADMIN' or 'USER'
      currentUserEmail: 'admin@blueplate.ph',
      alertFilter: 'ALL',
      formRating: 5,

      restaurants: [
        {
          id: 1,
          name: 'Dimsum Treats',
          branch: 'Dapitan St',
          zone: 'UST - Dapitan St',
          nearestGate: 'Dapitan Gate 11 (0.18 km)',
          cuisine: 'Silog & Rice Meals',
          priceRange: '₱85 – ₱165',
          avgPricePhp: 125,
          proxyDeliveryMins: 24.5,
          verifiedDeliveryMins: 23.0,
          cancellationProxyPct: 3.2,
          publicRating: 4.7,
          userReviews: [
            { user: 'student@ust.edu.ph', mins: 23, rating: 5, cancelled: false, note: 'Super fast delivery to Dapitan Gate 11 even at 12:15 PM rush.', time: '18 mins ago' }
          ]
        },
        {
          id: 2,
          name: 'Mang Tootz Food House',
          branch: 'P. Noval St',
          zone: 'UST - P. Noval St',
          nearestGate: 'P. Noval Gate 7 (0.15 km)',
          cuisine: 'Silog & Rice Meals',
          priceRange: '₱95 – ₱180',
          avgPricePhp: 135,
          proxyDeliveryMins: 36.0,
          verifiedDeliveryMins: 39.0,
          cancellationProxyPct: 11.4,
          publicRating: 4.5,
          userReviews: [
            { user: 'auditor.noval@ust.edu.ph', mins: 39, rating: 4, cancelled: false, note: 'Banana rhuma sold out during lunch; slight prep delay.', time: '1 hour ago' }
          ]
        },
        {
          id: 3,
          name: 'Silingan Coffee & Study Hub',
          branch: 'España Blvd',
          zone: 'UST - España Blvd',
          nearestGate: 'España Gate 2 (0.12 km)',
          cuisine: 'Milktea & Coffee',
          priceRange: '₱110 – ₱195',
          avgPricePhp: 145,
          proxyDeliveryMins: 43.5,
          verifiedDeliveryMins: 46.0,
          cancellationProxyPct: 16.2,
          publicRating: 4.1,
          userReviews: [
            { user: 'student@ust.edu.ph', mins: 46, rating: 3, cancelled: false, note: 'Heavy España traffic slowed rider turnaround by 15 mins.', time: '2 hours ago' }
          ]
        },
        {
          id: 4,
          name: "Lola Ote's Carinderia & Grill",
          branch: 'Dapitan cor. Asturias',
          zone: 'UST - Dapitan St',
          nearestGate: 'Dapitan Gate 10 (0.24 km)',
          cuisine: 'Silog & Rice Meals',
          priceRange: '₱75 – ₱150',
          avgPricePhp: 110,
          proxyDeliveryMins: 22.0,
          verifiedDeliveryMins: 21.0,
          cancellationProxyPct: 2.5,
          publicRating: 4.8,
          userReviews: [
            { user: 'campus.lead@blueplate.ph', mins: 21, rating: 5, cancelled: false, note: 'Consistent budget meals, zero missing items.', time: '3 hours ago' }
          ]
        },
        {
          id: 5,
          name: 'Seoul Bowl Korean Kitchen',
          branch: 'The One Torre de Santo Tomas',
          zone: 'UST - España Blvd',
          nearestGate: 'España Gate 1 (0.09 km)',
          cuisine: 'Korean & Asian Bowls',
          priceRange: '₱149 – ₱269',
          avgPricePhp: 198,
          proxyDeliveryMins: 28.0,
          verifiedDeliveryMins: 27.5,
          cancellationProxyPct: 4.1,
          publicRating: 4.6,
          userReviews: []
        },
        {
          id: 6,
          name: 'Tiger Winx & Burgers',
          branch: 'P. Noval cor. Delos Reyes',
          zone: 'UST - P. Noval St',
          nearestGate: 'P. Noval Gate 7 (0.29 km)',
          cuisine: 'Fast Food & Burgers',
          priceRange: '₱130 – ₱299',
          avgPricePhp: 185,
          proxyDeliveryMins: 33.5,
          verifiedDeliveryMins: 35.0,
          cancellationProxyPct: 8.7,
          publicRating: 4.3,
          userReviews: []
        },
        {
          id: 7,
          name: 'Lacson Ramen & Donburi',
          branch: 'A.H. Lacson Ave',
          zone: 'UST - Lacson Ave',
          nearestGate: 'Lacson Gate 14 (0.21 km)',
          cuisine: 'Korean & Asian Bowls',
          priceRange: '₱165 – ₱310',
          avgPricePhp: 225,
          proxyDeliveryMins: 25.0,
          verifiedDeliveryMins: 24.0,
          cancellationProxyPct: 3.0,
          publicRating: 4.7,
          userReviews: []
        },
        {
          id: 8,
          name: '24/7 Campus Brew & Boba',
          branch: 'A.H. Lacson cor. Aragon',
          zone: 'UST - Lacson Ave',
          nearestGate: 'Lacson Gate 14 (0.31 km)',
          cuisine: 'Milktea & Coffee',
          priceRange: '₱95 – ₱175',
          avgPricePhp: 130,
          proxyDeliveryMins: 26.5,
          verifiedDeliveryMins: 26.0,
          cancellationProxyPct: 3.8,
          publicRating: 4.5,
          userReviews: []
        }
      ],

      alerts: [
        {
          id: 101,
          severity: 'CRITICAL',
          zone: 'UST - España Blvd',
          restaurant: 'Silingan Coffee & Study Hub',
          metric: 'Delivery ETA & Cancellation Proxy',
          message: 'Avg delivery hit 44.8 mins (Target <= 35m) with 16.2% cancellation proxy due to España Blvd traffic bottleneck.',
          timestamp: '12 mins ago',
          status: 'OPEN' // 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'
        },
        {
          id: 102,
          severity: 'WARNING',
          zone: 'UST - P. Noval St',
          restaurant: 'Mang Tootz Food House',
          metric: 'Cancellation Proxy Index (11.4%)',
          message: 'Mid-shift stockouts on top lunch items triggered elevated cancellation signals along P. Noval Gate 7.',
          timestamp: '44 mins ago',
          status: 'OPEN'
        },
        {
          id: 103,
          severity: 'WARNING',
          zone: 'UST - Dapitan St',
          restaurant: 'Dimsum Treats',
          metric: 'Menu Price Change (+9.5%)',
          message: 'SCD Type 2 price tracker detected a ₱12 increase on steamed rice combo platters since yesterday.',
          timestamp: '2 hours ago',
          status: 'ACKNOWLEDGED'
        }
      ],

      managerNotes: [
        { zone: 'UST - España Blvd', text: 'Traffic rerouting near España Gate 2 between 11:30 AM – 1:30 PM.', author: 'admin@blueplate.ph', time: 'Today, 11:45 AM' },
        { zone: 'UST - Dapitan St', text: 'Dapitan corridor maintaining fastest rider dispatch (< 24 mins).', author: 'admin@blueplate.ph', time: 'Today, 10:15 AM' }
      ],

      dailyTrend: {
        labels: ['Mon (Regular)', 'Tue (Regular)', 'Wed (Quiz Day)', 'Thu (Prelims)', 'Fri (Prelims)', 'Sat (Exam Rush)', 'Sun (Review)'],
        deliveryMins: [26.2, 27.0, 29.4, 31.8, 33.2, 34.1, 28.5],
        orderDemand: [1120, 1190, 1340, 1580, 1710, 1640, 1290]
      }
    };

