---
"@mammothb/pi-office": patch
---

Fix SharePoint URL-parsing tests to match the corrected parser

Aligns the `load-sharepoint-url`, `load-sharepoint-client`, and
`load-sharepoint-tool` tests with the sharepoint URL parsing fix: the
document-library segment (`Shared Documents`, `Documents`, …) is dropped from
the drive-relative `itemPath`, and editor URLs keep only the `sourcedoc` query
param before the Graph shares endpoint resolves them. Test inputs that placed a
file directly under a `/sites/{site}` path now use a library folder so they
parse instead of throwing.
