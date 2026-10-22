---
"browser-review": patch
"@browser-review/vite-plugin": patch
---

Require Node.js 24.22.1 or newer on the 24 line, or 26.12.1 or newer. Older
releases still accept certificates from the compromised eMudhra (emSign)
intermediate CAs, so an HTTPS proxy target could be impersonated.
