# Daily archiver: copy every file in the Supabase `reports` bucket that is not
# yet archived. Idempotent and self-healing — a missed day is caught up on the
# next run.
#
# ─── Writes go to Cloudflare R2 since 2026-09-13 ────────────────────────────
# The archive used to be written to gs://mockstream-report-archive (Coldline,
# multi-region). Measured from the billing export, that bucket cost ~$7.5/mo and
# **~90% of it was the cost of WRITING**, not of storing or reading:
#
#   Coldline Class A operations   $1.70 / 14 days  (42,378 requests, ~3,000/day)
#   Multi-region replication      $1.46 / 14 days  (19.65 GB — every written byte
#                                                   is billed again to replicate)
#   Coldline storage              $0.30 / 14 days
#   everything anyone READ        $0.03 / 14 days
#
# On R2 the first million writes a month are free (we do ~90,000), there is no
# replication charge, and egress is free. So the same job costs nothing to run.
#
# ⚠️ The old objects were deliberately NOT migrated. Moving 82.84 GB out of
# Coldline would cost ~$12 once (retrieval + GCS egress) to save $0.35/mo — the
# stored bytes were never the expensive part. So the archive now lives in two
# places: everything written before the cut-over is on GCS, everything after is
# on R2, and the readers try both. **Never delete the GCS bucket.**
#
# ⚠️ Which is exactly why `have` below is the UNION of both listings. Listing
# only R2 would make the first run treat all 82 GB already on GCS as "missing",
# re-download it from Supabase and re-upload it — expensive and pointless.
#
# Env: ARCHIVE_LIST_TOKEN (matches site_settings.archive_list_token)
#      R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY  (S3 API keys, Object Read & Write)
#      R2_ACCOUNT_ID, R2_BUCKET, R2_PREFIX      (optional overrides)
#      ARCHIVE_MAX_NEW                          (safety ceiling, default 5000)
# Auth: gcloud must still be authenticated — it only LISTS the frozen GCS side.
import os, json, subprocess, urllib.request, urllib.parse, urllib.error, shutil, sys, time, mimetypes
from concurrent.futures import ThreadPoolExecutor

# Project-local secrets, loaded before the first os.environ read below.
# Two Cloudflare accounts once shared ONE set of Windows-global R2_* variables,
# so configuring one project silently broke the other: on 2026-09-13 the global
# R2_ACCOUNT_ID was left pointing at the other account while the keys still
# belonged to Mock Stream, which builds a valid-looking S3 client aimed at the
# wrong endpoint. This file WINS over the ambient environment on purpose — the
# ambient copy is exactly the part that goes stale. The CI runner has no .env,
# so the GitHub Secrets path in archive-reports.yml is untouched.
_envf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
if os.path.exists(_envf):
    with open(_envf, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            os.environ[_k.strip()] = _v.strip().strip('"').strip("'")

SB = "https://zknyukkbtbcqgvkgjktb.supabase.co"
ANON = "sb_publishable_SRLvRtRHU52FliLxA6gYaQ_I-v5LCk2"
TOKEN = os.environ["ARCHIVE_LIST_TOKEN"]
GCS = "gs://mockstream-report-archive"          # legacy, read-only from here on
STAGE = os.path.abspath("stage")
PAGE = 2000

# R2 target. The keys we hold are scoped to the `mockstream-audio` bucket, so the
# archive lives there under a prefix rather than in a bucket of its own; the
# public URL is https://audio.mock-stream.com/<R2_PREFIX>/<name>.
R2_ACCOUNT = os.environ.get("R2_ACCOUNT_ID", "5ba79ef3e377250a69af22b372251686")
R2_BUCKET = os.environ.get("R2_BUCKET", "mockstream-audio")
R2_PREFIX = os.environ.get("R2_PREFIX", "reports").strip("/")
# A run that thinks this much is missing has a broken listing, not a busy day.
MAX_NEW = int(os.environ.get("ARCHIVE_MAX_NEW", "5000"))


def list_supabase():
    names, after = [], ""
    while True:
        req = urllib.request.Request(
            SB + "/rest/v1/rpc/archive_list_files",
            data=json.dumps({"p_token": TOKEN, "p_after": after, "p_limit": PAGE}).encode(),
            headers={"apikey": ANON, "Content-Type": "application/json"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    page = json.loads(r.read())
                break
            except Exception:
                if attempt == 4: raise
                time.sleep(5 * (attempt + 1))
        if not page:
            return names
        names += [row["name"] for row in page]
        after = page[-1]["name"]


def list_gcs():
    """The legacy half of the archive. Frozen — nothing is written here any more,
       but it still has to be listed so we don't re-copy it into R2."""
    r = subprocess.run(f'gcloud storage ls "{GCS}/**"', shell=True,
                       capture_output=True, text=True)
    if r.returncode != 0 and "One or more URLs matched no objects" not in r.stderr:
        raise RuntimeError("gcloud ls failed: " + r.stderr[-500:])
    prefix = GCS + "/"
    return {line[len(prefix):] for line in r.stdout.splitlines()
            if line.startswith(prefix)}


def _s3():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def list_r2(s3):
    """Everything archived since the cut-over, as plain names (prefix stripped)."""
    names, token, pre = set(), None, R2_PREFIX + "/"
    while True:
        kw = {"Bucket": R2_BUCKET, "Prefix": pre, "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kw)
        for o in resp.get("Contents", []):
            names.add(o["Key"][len(pre):])
        if not resp.get("IsTruncated"):
            return names
        token = resp.get("NextContinuationToken")


def download(name):
    dest = os.path.join(STAGE, name.replace("/", os.sep))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = SB + "/storage/v1/object/public/reports/" + urllib.parse.quote(name)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            return None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return name + "\tHTTP404"
            if attempt == 3: return name + "\tHTTP" + str(e.code)
            time.sleep(3 * (attempt + 1))
        except Exception as e:
            if attempt == 3: return name + "\t" + repr(e)[:120]
            time.sleep(3 * (attempt + 1))


def upload(s3, name):
    """One staged file → R2. Content-type matters: a report fetched into an
       iframe as application/octet-stream is offered as a download instead of
       rendering. An archived report never changes, so it caches for a year."""
    src = os.path.join(STAGE, name.replace("/", os.sep))
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    for attempt in range(4):
        try:
            with open(src, "rb") as f:
                s3.upload_fileobj(f, R2_BUCKET, f"{R2_PREFIX}/{name}",
                                  ExtraArgs={"ContentType": ctype,
                                             "CacheControl": "public, max-age=31536000, immutable"})
            return None
        except Exception as e:
            if attempt == 3: return name + "\t" + repr(e)[:120]
            time.sleep(3 * (attempt + 1))


s3 = _s3()
sb_names = list_supabase()
on_gcs = list_gcs()
on_r2 = list_r2(s3)
have = on_gcs | on_r2
missing = [n for n in sb_names if n not in have]
print(f"supabase: {len(sb_names)} files | archived: {len(have)} "
      f"(gcs {len(on_gcs)} + r2 {len(on_r2)}) | to copy: {len(missing)}")

# A listing that silently returned nothing would present the whole archive as
# missing. Refuse rather than re-copy tens of gigabytes.
if len(missing) > MAX_NEW:
    print(f"REFUSING: {len(missing)} files look missing, which is more than "
          f"ARCHIVE_MAX_NEW={MAX_NEW}. A listing probably failed — check the "
          f"gcs/r2 counts above before raising the ceiling.")
    sys.exit(1)

if missing:
    if os.path.exists(STAGE): shutil.rmtree(STAGE)
    os.makedirs(STAGE)
    with ThreadPoolExecutor(12) as ex:
        fails = [f for f in ex.map(download, missing) if f]
    for f in fails:
        print("FAILED download " + f)

    staged = [n for n in missing if os.path.exists(os.path.join(STAGE, n.replace("/", os.sep)))]
    with ThreadPoolExecutor(12) as ex:
        up_fails = [f for f in ex.map(lambda n: upload(s3, n), staged) if f]
    for f in up_fails:
        print("FAILED upload " + f)

    copied = len(staged) - len(up_fails)
    print(f"archived {copied} new files to r2://{R2_BUCKET}/{R2_PREFIX}"
          + (f", {len(fails)} download failures" if fails else "")
          + (f", {len(up_fails)} upload failures" if up_fails else ""))

    # Only hard-fail if a meaningful share failed. Transient 404s on download are
    # normal — a report can be deleted between listing and fetch. An UPLOAD
    # failure is different: nothing else will retry that file until tomorrow, so
    # any of them is worth failing the run over once they stop being isolated.
    if fails and len(fails) > max(5, len(missing) // 10):
        sys.exit(1)
    if up_fails and len(up_fails) > max(2, len(staged) // 20):
        sys.exit(1)
else:
    print("nothing to archive")
