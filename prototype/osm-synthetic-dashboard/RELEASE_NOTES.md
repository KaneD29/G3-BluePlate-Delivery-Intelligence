# BluePlate Flask Step 7.15J.11

The one canonical dashboard now uses a unified versioned warehouse and includes 274 approved restaurants, 274 current scenario facts and the preserved historical model. The reporting portal is separate and retains its picker and receipt flow. The dashboard includes six headline KPIs, reporting periods, three distance bands, an accessible zone dialog, scenario ETA ranges, travel difficulty, hypothetical demand, delivery notices and human-reviewed restaurant names and addresses.

The deployment seed omits all genuine guest data. The new installer supports a fresh MySQL 8.0 warehouse and exact compatible historical warehouses. Installation and deployment are explicit operator actions. A CA path enables hostname and certificate verification for RDS. No automated external refresh or hosted report submission is enabled by default.

Proposed commit message: `Prepare BluePlate Flask J.11 with versioned warehouse deployment`.

Current cuisine and food-specialty display uses a reviewed vocabulary, separately from establishment type. Unresolved records display Not specified.

## Step 7.15L follow-up

Adds opt-in unlisted restaurant reporting and private identity review, while preserving the approved directory and modeled snapshots. Migration 14 is additive.
