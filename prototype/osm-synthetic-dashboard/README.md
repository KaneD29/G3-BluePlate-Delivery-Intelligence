# BluePlate Delivery Intelligence

BluePlate is a Flask and MySQL academic capstone for campus food delivery around UST Manila. The public reporting portal and one BI dashboard separate actual student feedback, current directory coverage and modeled estimates.

- Current directory and modeled date: 274 approved venues on November 25, 2026 Manila.
- Historical November 15 snapshot: 123 legacy fact rows and 119 operational venues in the dashboard.
- Zone A, B and C: 67, 69 and 138 venues within successive 500-meter straight-line bands around UST.
- OpenStreetMap attribution: © OpenStreetMap contributors, ODbL 1.0.

See DATABASE_SETUP.md for the Linux/MySQL setup and DEPLOYMENT.md for operating requirements. The application includes public schema and methodology at /dashboard/schema/versioned-bi.sql and /dashboard/schema/warehouse-methodology.

The seed contains only reviewed public directory and modeled data. Student feedback is counted dynamically. See KNOWN_LIMITATIONS.md for interpretation and security boundaries.
