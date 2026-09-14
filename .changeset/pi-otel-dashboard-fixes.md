---
"@mammothb/pi-otel": patch
---

Polish the sample Grafana dashboard and the local otel-lgtm stack:

- Tool execution duration (distribution): fixed-color overrides per bucket
  (`0-10ms` green, `10-100ms` blue, `100ms-1s` yellow, `1-10s` orange,
  `>10s` red) instead of the default palette.
- Activity row: the three panels are now evenly sized (`w=8` each, `x=0/8/16`)
  filling the 24-wide row.
- Tool call distribution, Tool calls by name, Tool error rate, and Tool
  execution duration: queries switched from fixed windows (`[1h]` / `[5m]`)
  and raw counters to `$__range`-scoped `increase()` / `rate()`, plus a
  `> 0` filter so tools with no activity in the selected range no longer
  appear with `none` / `0%` entries.
- otel-lgtm compose: set `GF_DASHBOARDS_DASHBOARDS_ALLOW_UI_UPDATES=true`
  so the bundled OTel dashboards (JVM Overview, RED Metrics ×2) can be
  deleted from the UI.
