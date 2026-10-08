legend-dashboard/
├── AGENTS.md
├── ARCHITECTURE.md
├── README.md
├── .env.example
├── package.json
│
├── docs/
│   ├── product/
│   │   ├── blueprint.md
│   │   ├── tiers.md
│   │   └── metric-definitions.md
│   │
│   ├── data/
│   │   ├── source-policy.md
│   │   ├── provenance.md
│   │   ├── historical-eras.md
│   │   └── reliability-scoring.md
│   │
│   ├── architecture/
│   │   ├── snapshots.md
│   │   ├── ingestion.md
│   │   └── rendering.md
│   │
│   └── exec-plans/
│       ├── active/
│       └── completed/
│
├── src/
│   ├── contracts/
│   ├── ingestion/
│   ├── normalization/
│   ├── metrics/
│   ├── validation/
│   ├── api/
│   └── rendering/
│
├── schemas/
│   ├── player.schema.json
│   ├── source-record.schema.json
│   ├── provenance.schema.json
│   ├── snapshot.schema.json
│   ├── metric.schema.json
│   └── dashboard/
│       └── application payload schemas (Draft 7; same draft as canonical contracts)
│
├── fixtures/
│   └── cr7-vs-messi/
│
└── tests/
    └── fixtures/
        ├── valid/
        └── invalid/
