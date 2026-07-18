---
"@mammothb/pi-office": patch
---

Add `raw` parameter to `read_xlsx` so the model can request display-formatted values (dates as "3/15/24", currencies as "$1,234.56", percentages as "8.50%") instead of raw numeric storage values. Defaults to `true` for backward compatibility.
