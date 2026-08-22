# otel-lgtm dev stack

Grafana's all-in-one observability image (Loki + Tempo + Mimir + Grafana + OTel
Collector) for local verification of `@mammothb/pi-otel`.

```sh
docker compose up -d
```

| Service | URL |
| --- | --- |
| Grafana | http://localhost:3000 (admin/admin, anonymous enabled) |
| OTLP HTTP | http://localhost:4318 |
| OTLP gRPC | http://localhost:4317 |

Then point pi-otel at the default endpoint (`http://localhost:4318` — already
the default) and run pi. Import `../../dashboards/pi-otel.json` into Grafana to
see the prebuilt panels. Spans land in Tempo, metrics in Prometheus (Mimir).
