-- Daily counters behind the broker's budgets: tool calls per installation, per
-- Composio user and in total, and registrations per client address. One row
-- per scope, key and UTC day; the hourly job deletes days older than a week.
CREATE TABLE usage_counters (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, key, day)
);

CREATE INDEX usage_counters_day_idx ON usage_counters(day);
