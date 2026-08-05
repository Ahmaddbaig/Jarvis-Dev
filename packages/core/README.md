# `@jarvis/core`

Framework-independent Jarvis use cases, capability policy, approvals, and orchestration.

Core may depend on `@jarvis/contracts`; it must not depend on React components, Next.js request objects, Electron windows, or vendor-native model payloads. Adapters call into Core through validated contracts.
