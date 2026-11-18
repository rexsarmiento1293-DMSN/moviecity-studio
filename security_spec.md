# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Strict Ownership (`DramaProjectDoc`)**: Every document in `/drama_projects/{projectId}` must have `ownerId == request.auth.uid` and require a verified email (`request.auth.token.email_verified == true`).
2. **Path Variable Hardening**: `projectId` must match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.
3. **Strict Key & Size Enforcement**: Every create and update operation must validate all required keys (`hasAll` and `hasOnly`), enforce string length boundaries matching `firebase-blueprint.json`, and reject any shadow/ghost fields.
4. **Temporal & Identity Immutability**: `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on every write; `ownerId` is immutable after creation.
5. **Query Enforcer on List**: `allow list` on `/drama_projects/{projectId}` explicitly requires `resource.data.ownerId == request.auth.uid`.

## 2. The "Dirty Dozen" Payloads
1. **Identity Spoofing**: Creating a project with `ownerId: "victim-uid"` when authenticated as `"attacker-uid"` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoofing**: Writing with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection**: Updating or creating with an extra key `isAdmin: true` -> `PERMISSION_DENIED`.
4. **ID Poisoning**: Creating a document with a 500-character or special-character `projectId` -> `PERMISSION_DENIED`.
5. **Denial of Wallet (Oversized Prompt)**: Writing a `prompt` string > 2,000 characters -> `PERMISSION_DENIED`.
6. **Invalid Status Enum**: Setting `status: "Hacked"` instead of `Draft | Generating | Done` -> `PERMISSION_DENIED`.
7. **Invalid Resolution Enum**: Setting `resolution: "8K"` instead of `480p | 720p | 1080p` -> `PERMISSION_DENIED`.
8. **Ownership Hijack on Update**: Modifying `ownerId` during `update` -> `PERMISSION_DENIED`.
9. **Backdated Timestamp Forgery**: Supplying a forged past timestamp for `createdAt` or `updatedAt` (!= `request.time`) -> `PERMISSION_DENIED`.
10. **Immutable CreatedAt Mutation**: Changing `createdAt` during an `update` -> `PERMISSION_DENIED`.
11. **Unauthorized List Scraping**: Listing `/drama_projects` without filtering `ownerId == request.auth.uid` -> `PERMISSION_DENIED`.
12. **Cross-Tenant Delete**: Deleting a `/drama_projects/{projectId}` where `resource.data.ownerId != request.auth.uid` -> `PERMISSION_DENIED`.
