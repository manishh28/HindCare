# Capability Map: Lucknow Facility Directory

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| facility-directory | Import, deduplicate, store, and serve unverified facility listings. | — |
| facility-map | Public PIN-code search and a map of directory listings. | facility-directory |
| coverage-analytics | Super-admin-only coverage and data-quality aggregates. | facility-directory |
| dispatch-routing | Verified availability, ambulance telemetry, and human-reviewed destination recommendations. | facility-directory, facility-map |

Build order: `facility-directory` -> `facility-map` -> `coverage-analytics` -> `dispatch-routing`.

The existing `hospitals` table remains the verified HindCare partner and booking-destination registry. Imported directory listings never become bookable, approved, or emergency-capable solely through import.
