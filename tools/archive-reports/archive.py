# Daily archiver: copy every file in the Supabase `reports` bucket that is
# not yet in gs://mockstream-report-archive. Idempotent and self-healing —
# a missed day is simply caught up on the next run.
#
# Env: ARCHIVE_LIST_TOKEN (matches site_settings.archive_list_token).
# Auth: gcloud must already be authenticated (google-github-actions/auth).
import os, json, subprocess, urllib.request, urllib.parse, urllib.error, shutil, sys, time
from concurrent.futures import ThreadPoolExecutor

SB = "https://zknyukkbtbcqgvkgjktb.supabase.co"
ANON = "sb_publishable_SRLvRtRHU52FliLxA6gYaQ_I-v5LCk2"
TOKEN = os.environ["ARCHIVE_LIST_TOKEN"]
GCS = "gs://mockstream-report-archive"
STAGE = os.path.abspath("stage")
PAGE = 2000

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
    r = subprocess.run(f'gcloud storage ls "{GCS}/**"', shell=True,
                       capture_output=True, text=True)
    if r.returncode != 0 and "One or more URLs matched no objects" not in r.stderr:
        raise RuntimeError("gcloud ls failed: " + r.stderr[-500:])
    prefix = GCS + "/"
    return {line[len(prefix):] for line in r.stdout.splitlines()
            if line.startswith(prefix)}

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

sb_names = list_supabase()
have = list_gcs()
missing = [n for n in sb_names if n not in have]
print(f"supabase: {len(sb_names)} files, archived: {len(have)}, to copy: {len(missing)}")

if missing:
    if os.path.exists(STAGE): shutil.rmtree(STAGE)
    os.makedirs(STAGE)
    with ThreadPoolExecutor(12) as ex:
        fails = [f for f in ex.map(download, missing) if f]
    for f in fails:
        print("FAILED " + f)
    r = subprocess.run(f'gcloud storage rsync --recursive "{STAGE}" {GCS}',
                       shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:]); sys.exit(1)
    copied = len(missing) - len(fails)
    print(f"archived {copied} new files" + (f", {len(fails)} failed" if fails else ""))
    # only hard-fail if a meaningful share failed (transient 404s are normal:
    # a report can be deleted between listing and download)
    if fails and len(fails) > max(5, len(missing) // 10):
        sys.exit(1)
else:
    print("nothing to archive")
