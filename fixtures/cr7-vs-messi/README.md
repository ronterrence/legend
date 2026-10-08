# Synthetic comparison fixture

The deterministic fixture is defined in src/ingestion/demo.ts and seeded into each new local database. It uses player identities for layout, but every numerical value is invented. It must retain the DEMO label in screenshots, exports and saved comparisons. Trophy and award values are intentionally missing.

Tests create isolated copies and exercise missing minutes, assists, zero denominators, scope conflicts and rounding ties. Real RSSSF evidence is stored in runtime/sources and review reports in runtime/reports; it is never substituted into the synthetic fixture.
