# AI Package

Site-scoped AI budget admission, immutable usage reconciliation, configurable model
aliases, and the single bounded provider adapter. Monetary amounts use integer USD
microdollars; the default monthly site cap is 5,000,000 ($5.00). Calendar periods are
UTC and reservations intentionally use conservative estimates. The worker/runtime
package supplies `PostgresAiBudgetLedger`, whose database functions lock platform
capacity before site capacity, finalize reservations, and refresh both counters
atomically. The in-memory ledger is a test double only.
