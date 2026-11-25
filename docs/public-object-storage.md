# Public object storage

Use public object storage when your Baguette instance is **not reachable from the internet** — for example behind a VPN, SSH tunnel, or private network. In that setup GitHub cannot fetch `https://your-instance/api/images/...` when the pull request description is synced, and you may not want to depend on the instance serving anonymous image URLs at all.

Configure an S3-compatible bucket under **Admin → Public storage**. Baguette uploads session images there and embeds public HTTPS URLs in the GitHub PR body.

## Admin fields

| Field                                     | Purpose                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Endpoint URL**                          | S3 API host (e.g. `https://s3.eu-west-1.amazonaws.com` or your MinIO URL).                                         |
| **Bucket name**                           | Target bucket.                                                                                                     |
| **Region**                                | Optional; required by some providers (e.g. AWS).                                                                   |
| **Access key id** / **Secret access key** | Credentials for PUT/DELETE against the bucket. Encrypted at rest; the secret is **never** returned to the browser. |
| **Public base URL**                       | Origin where anonymous clients read objects (custom domain, CDN, or provider public URL).                          |

**Test connection** only checks API credentials: Baguette writes and deletes a small object under `baguette/_health/`. It does **not** verify that the public base URL is reachable or that anonymous GET works — configure bucket policy or CDN access separately.

## Pull request image URLs

When public storage is configured and the session description contains `{{image:<image_slug>}}` placeholders, Baguette uploads each image on description sync. The PR body receives a markdown image link whose path is **not** the session id or the placeholder slug:

```text
https://<public-base>/baguette/<256-bit-random-token>.<ext>
```

The token is 32 bytes from a CSPRNG (`base64url`). It is the only thing that authorizes a read: the bucket stays anonymously readable, and the filename is the secret. Do not enable anonymous `ListBucket`. The placeholder slug agents write into the description is a different id and does not appear in the object name. The extension (`.png`, `.jpg`, `.gif`, `.webp`) is only a content hint.

## Public read access

Objects must be readable **without authentication** at the public base URL (direct bucket access, bucket website, or CDN in front of the bucket). Restrict anonymous access to `GetObject` on the `baguette/` prefix. Listing must stay private; a public list would bypass the unguessable names.

### AWS S3 bucket policy (example)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BaguettePublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET/baguette/*"
    }
  ]
}
```

Replace `BUCKET` with your bucket name. IAM credentials used by Baguette need `s3:PutObject` and `s3:DeleteObject` on `baguette/*`. Do not grant anonymous `s3:ListBucket`.

### Cloudflare R2

Create an R2 bucket, connect a custom domain or enable the `r2.dev` public bucket URL, and set **Public base URL** to that origin. Use the R2 S3 API endpoint and API token credentials in the admin form. Apply a public access rule or CDN configuration so `GET` on `baguette/*` succeeds for anonymous clients.

### MinIO (path-style)

Set **Endpoint URL** to your MinIO API base (e.g. `https://minio.example.com`) and **Bucket name** separately (path-style addressing). Set **Public base URL** to wherever anonymous reads are served (MinIO console public bucket URL, nginx reverse proxy, or CDN). Ensure the bucket policy allows public `GetObject` on `baguette/*`.

## Grooming unused images

**Admin → Public storage → Remove unused images** deletes images that are **not** referenced by any session’s current description and are **older than one hour**, both from local disk and from the bucket.

Description sync for a session also grooms unused images for **that** session.

## Archiving sessions

When a session is archived, Baguette deletes all of its images locally and removes the corresponding objects from the bucket.

## Security notes

- Access keys are stored encrypted in the instance database; only non-secret fields and `secret_configured` are exposed to the admin UI.
- The public bucket policy should allow read only under `baguette/`, not the whole bucket. Anonymous listing must stay off; the random object name is what keeps a URL private.
- Test connection does not prove that GitHub or end users can reach **Public base URL** — verify that separately after DNS and TLS are in place.
