# Spec: Lucknow Facility Directory

## Objective

Add a read-only directory of external Lucknow healthcare listings without changing the verified HindCare partner registry, booking flow, or ambulance dispatch logic. The first release lets a visitor find a hospital or clinic by PIN code and view its location on a map.

## Scope

- Import the supplied per-PIN JSON snapshots through an explicit, repeatable server-side import command.
- Deduplicate a facility by its external `place_id`.
- Preserve `source_pin_code` (the input filename) and `resolved_pin_code` (a six-digit PIN parsed from the address).
- Store coordinates, facility name, type, address, phone, and website only.
- Mark every imported record `unverified`.
- Return a paginated, read-only public facility list filtered by PIN code and facility category.

## Non-goals

- No change to `hospitals`, booking destinations, auto-dispatch, hospital approvals, or emergency routing.
- No publication of ratings, review counts, reviews, photos, thumbnails, or Google/SerpAPI links until data rights are confirmed.
- No reverse-geocoding call in the first release. A missing address PIN falls back to the source filename and is labelled as such.
- No claim that a directory listing has emergency, ICU, bed, or ambulance availability.

## Data Rules

1. `place_id` is the unique external identity.
2. `resolved_pin_code` is the first six-digit PIN in the normalized address; otherwise it equals `source_pin_code`.
3. `pin_confidence` is `address` when the address contains the PIN and `source` when it does not.
4. Imported facility types are normalized into `hospital`, `clinic`, `other`, or `unknown`.
5. The public view defaults to `hospital` and `clinic`; other records remain stored but are not returned unless explicitly requested in a later approved change.
6. All external fields are treated as untrusted input and are length-validated before storage.

## API Contract

### `GET /api/facilities`

Public, read-only directory endpoint.

Query parameters:

- `pinCode`: optional six-digit PIN code.
- `type`: optional `hospital` or `clinic`.
- `page`: optional positive integer, default `1`.
- `pageSize`: optional integer from `1` to `50`, default `20`.

Successful response:

```json
{
  "data": [
    {
      "id": 1,
      "name": "Example Hospital",
      "type": "hospital",
      "address": "Example Road, Lucknow 226002",
      "pinCode": "226002",
      "pinConfidence": "address",
      "latitude": 26.85,
      "longitude": 80.95,
      "phone": "+91-9000000000",
      "website": "https://example.org",
      "verificationStatus": "unverified"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
}
```

Invalid filters return HTTP `400` with the existing `{ "error": "..." }` response shape. The endpoint never returns external review, rating, image, or raw provider metadata.

## Tech Stack And Commands

- Node.js built-in HTTP server, PostgreSQL, static HTML/CSS/JavaScript, Leaflet already bundled in the project.
- Start: `node backend/server.js`
- Focused import check: `node --test tests/facility-directory.test.js`
- Full check: `node --test`

## Project Structure

```text
database/migrations/  -> additive PostgreSQL migration
backend/              -> import and public read endpoint
frontend/             -> directory search and Leaflet map
tests/                -> Node built-in tests for normalization and PIN resolution
docs/                 -> this contract and capability map
```

## Code Style

Use parameterized SQL and the existing camelCase API fields.

```js
const result = await pool.query(
  "SELECT id, name FROM facility_directory WHERE resolved_pin_code = $1",
  [pinCode]
);
```

## Testing Strategy

- Small Node tests cover a source-PIN/address-PIN mismatch, a missing address PIN fallback, and duplicate `place_id` input.
- A manual check confirms `GET /api/facilities?pinCode=226002&type=hospital` returns only directory records.
- A browser check confirms the map renders the returned coordinates and provides no booking action for unverified listings.

## Boundaries

- Always: validate external JSON, parameterize SQL, preserve the partner-directory boundary, and label listings as unverified.
- Ask first: apply a database migration, publish external ratings/photos/reviews, add a third-party geocoding or routing provider, or connect a directory listing to booking/dispatch.
- Never: use external listing ratings for clinical recommendations, treat a listing as a partner, or expose raw imported provider payloads.

## Success Criteria

1. A duplicate facility in two PIN files creates one directory record with the first source PIN retained for audit.
2. A record whose address PIN differs from its filename is searchable by the address PIN and marked `address` confidence.
3. Existing `/api/hospitals` and all booking behavior are unchanged.
4. Only hospital and clinic records are visible by default, and every result is labelled unverified.
5. No ratings, reviews, images, or external provider links appear in the response or UI.

## Open Questions

- Confirm the right to publish the supplied Google/SerpAPI-derived listing data before the directory is enabled on the public Render deployment.
- Confirm whether the first import should be a local/staging-only dataset or the production Supabase database.
