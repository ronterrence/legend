legend-dashboard/
├── AGENTS.md
├── ARCHITECTURE.md
├── README.md
├── .env.example
├── pyproject.toml / package.json
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
│   ├── ingestion/
│   ├── normalization/
│   ├── metrics/
│   ├── validation/
│   ├── api/
│   └── rendering/
│
├── schemas/
│   ├── player.schema.json
│   ├── metric.schema.json
│   ├── snapshot.schema.json
│   └── provenance.schema.json
│
├── fixtures/
│   └── cr7-vs-messi/
│
└── tests/