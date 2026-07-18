# @mammothb/pi-office

## 0.1.4

### Patch Changes

- 40fa62a: Add `raw` parameter to `read_xlsx` so the model can request display-formatted values (dates as "3/15/24", currencies as "$1,234.56", percentages as "8.50%") instead of raw numeric storage values. Defaults to `true` for backward compatibility.

## 0.1.3

### Patch Changes

- 5ce9e7c: Bump pi dependencies to 0.80.10

## 0.1.2

### Patch Changes

- Updated dependencies [5de3594]
  - @mammothb/pi-shared@1.4.0

## 0.1.1

### Patch Changes

- d1e19c5: Tighten tool prompts for token efficiency: trim bloated descriptions, add missing `promptGuidelines`, ensure every guideline names its tool explicitly per pi SDK convention
