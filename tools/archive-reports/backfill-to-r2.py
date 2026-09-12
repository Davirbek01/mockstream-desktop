# One-off backfill: copy the frozen GCS report archive into R2.
# ---------------------------------------------------------------------------
# The nightly archiver writes to R2 since 2026-09-13. This moves the history so
# there is ONE archive again instead of two, which is what lets every reader use
# a single address instead of probing both.
#
# Why it is worth ~$9 once: leaving the history on GCS costs nothing in storage
# but forces a two-store fallback into 11 different read paths — including four
# compact inline scripts that swap a failed <audio> source, which today allow
# exactly one retry. Paying once to delete that complexity is the better trade.
#
# ⚠️ Resumable and idempotent, like archive.py: every run lists both sides and
# copies only the difference. If it dies at 80%, run it again. Nothing is ever
# deleted here — the GCS copy stays until Davirbek says otherwise.
#
# Env: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   (S3 keys, Object Read & Write)
#      R2_ACCOUNT_ID, R2_BUCKET, R2_PREFIX       (optional overrides)
#      BACKFILL_LIMIT                            (copy at most N — for a trial run)
#      BACKFILL_WORKERS                          (default 16)
# Auth: gcloud must be authenticated; it is used only to LIST the GCS side.
#       The objects themselves are fetched over the bucket's public URL.
import os, sys, subprocess, urllib.request, urllib.error, urllib.parse, mimetypes, time, threading
from concurrent.futures import ThreadPoolExecutor

GCS_BUCKET = os.environ.get("GCS_ARCHIVE_BUCKET", "mockstream-report-archive")
GCS_PUBLIC = f"https://storage.googleapis.com/{GCS_BUCKET}/"
R2_ACCOUNT = os.environ.get("R2_ACCOUNT_ID", "5ba79ef3e377250a69af22b372251686")
R2_BUCKET  = os.environ.get("R2_BUCKET", "mockstream-audio")
R2_PREFIX  = os.environ.get("R2_PREFIX", "reports").strip("/")
LIMIT      = int(os.environ.get("BACKFILL_LIMIT", "0") or 0)
WORKERS    = int(os.environ.get("BACKFILL_WORKERS", "16"))


def s3_client():
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        # Each worker needs its own connection or they queue behind one another.
        config=Config(max_pool_connections=WORKERS + 4, retries={"max_attempts": 3}),
    )


def list_gcs():
    r = subprocess.run(f'gcloud storage ls "gs://{GCS_BUCKET}/**"', shell=True,
                       capture_output=True, text=True)
    if r.returncode != 0 and "One or more URLs matched no objects" not in r.stderr:
        raise RuntimeError("gcloud ls failed: " + r.stderr[-500:])
    pre = f"gs://{GCS_BUCKET}/"
    return [l[len(pre):] for l in r.stdout.splitlines() if l.startswith(pre)]


def list_r2(s3):
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


done = 0
lock = threading.Lock()


def copy_one(s3, name):
    """GCS public GET → R2 PUT. Returns None on success, or 'name\\treason'."""
    global done
    url = GCS_PUBLIC + urllib.parse.quote(name)
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                body = r.read()
            s3.put_object(Bucket=R2_BUCKET, Key=f"{R2_PREFIX}/{name}", Body=body,
                          ContentType=ctype,
                          CacheControl="public, max-age=31536000, immutable")
            with lock:
                done += 1
                if done % 500 == 0:
                    print(f"  … {done} copied", flush=True)
            return None
        except urllib.error.HTTPError as e:
            # 404 means the listing and the object disagree — skip, don't retry.
            if e.code == 404:
                return name + "\tHTTP404"
            if attempt == 3:
                return name + "\tHTTP" + str(e.code)
        except Exception as e:
            if attempt == 3:
                return name + "\t" + repr(e)[:120]
        time.sleep(3 * (attempt + 1))


s3 = s3_client()
print("listing both sides …", flush=True)
gcs_names = list_gcs()
r2_names = list_r2(s3)
missing = [n for n in gcs_names if n not in r2_names]
print(f"gcs: {len(gcs_names)} | already on r2: {len(r2_names)} | to copy: {len(missing)}", flush=True)

if LIMIT and len(missing) > LIMIT:
    missing = missing[:LIMIT]
    print(f"TRIAL RUN — limited to {LIMIT}", flush=True)

if not missing:
    print("nothing to copy — the backfill is complete")
    sys.exit(0)

started = time.time()
with ThreadPoolExecutor(WORKERS) as ex:
    fails = [f for f in ex.map(lambda n: copy_one(s3, n), missing) if f]

mins = (time.time() - started) / 60
print(f"\ncopied {len(missing) - len(fails)} of {len(missing)} in {mins:.1f} min", flush=True)
for f in fails[:50]:
    print("FAILED " + f)
if len(fails) > 50:
    print(f"… and {len(fails) - 50} more failures")

# A handful of failures is normal on a set this size and the next run retries
# them. A large share means something systemic — stop and look.
if fails and len(fails) > max(20, len(missing) // 50):
    sys.exit(1)
