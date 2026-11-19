# Neon migration implementation plan

Move Lomi English to the new Neon project. Preserve the existing review, synchronization, and recording flows through PostgreSQL, Managed Better Auth, and private Neon Object Storage.

1. Build the Neon PostgreSQL migration from the current cloud and voice migrations. Test member isolation, the synchronization revision checks, the quota function and the voice audio permission function against PostgreSQL semantics before applying to the new project.
2. Keep the existing application data queries and RPCs through the Neon Data API. Connect Managed Better Auth for sign-in and email recovery, and verify the invitation-only enrollment workflow. Keep configuration credentials in the hosting environment.
3. Route voice files through authenticated Render endpoints and use a private S3-compatible bucket. Authorize each object by owner and live history metadata. Test upload, download, retry and cleanup against the existing voice transport.
4. Verify a disposable deployment with two accounts, an inactive account, cloud revisions, and recorded audio. Prepare a production switch with a fresh build and retain the original Supabase project for later data recovery.
