"""Exercise the production HTTP routes against a separate copy of the local database.

No model calls are made. Real evaluations and human review records are never changed.
Run with the bundled Python runtime after `npm run build`.
"""
import base64
import csv
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / ".local" / ("manual-review-http-" + uuid.uuid4().hex[:10])
RUN.mkdir(parents=True)
CONFIG = {}
for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        CONFIG[key.strip()] = value.strip().strip('"').strip("'")

fixture = RUN / "test.db"
with sqlite3.connect((ROOT / "prisma" / "dev.db").as_uri() + "?mode=ro", uri=True) as source, sqlite3.connect(fixture) as copied:
    source.backup(copied)
with sqlite3.connect(fixture) as db:
    task_id, owner_id = db.execute('SELECT id,userId FROM EvaluationTask ORDER BY createdAt DESC LIMIT 1').fetchone()
    username = db.execute('SELECT username FROM User WHERE id=?', (owner_id,)).fetchone()[0]
    result_id = db.execute('SELECT id FROM EvaluationResult WHERE evaluationTaskId=? ORDER BY rowIndex LIMIT 1', (task_id,)).fetchone()[0]
    baseline = db.execute('SELECT score,passed,reason,rawResponse FROM EvaluationResult WHERE id=?', (result_id,)).fetchone()
    other_id = "http-fixture-other"
    db.execute('INSERT INTO User(id,username,passwordHash,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP)', (other_id, "http-fixture-other", "test-only"))
    db.commit()

def token(user_id, name):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")
    message = encode({"alg": "HS256"}) + b"." + encode({"uid": user_id, "username": name, "iat": int(time.time()), "exp": int(time.time()) + 600})
    signature = base64.urlsafe_b64encode(hmac.new(CONFIG["AUTH_SECRET"].encode(), message, hashlib.sha256).digest()).rstrip(b"=")
    return (message + b"." + signature).decode()

with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
BASE = f"http://127.0.0.1:{port}"
COOKIE = "eval_agent_session=" + token(owner_id, username)

def request(route, body=None, cookie=COOKIE, origin=None):
    headers = {"Cookie": cookie} if cookie else {}
    if body is not None:
        headers["Content-Type"] = "application/json"
        headers["Origin"] = origin or BASE
    req = urllib.request.Request(BASE + route, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers

def data(route):
    status, content, _ = request(route)
    assert status == 200, (route, status)
    return json.loads(content)["data"]

environment = {**os.environ, **CONFIG, "DATABASE_URL": "file:" + fixture.as_posix()}
stdout = (RUN / "stdout.log").open("w", encoding="utf-8")
stderr = (RUN / "stderr.log").open("w", encoding="utf-8")
process = subprocess.Popen([r"C:\Program Files\nodejs\node.exe", str(ROOT / "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", str(port)], cwd=ROOT, env=environment, stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW)
report = {}
try:
    for attempt in range(60):
        if process.poll() is not None:
            raise RuntimeError("Fixture server exited; inspect the fixture logs")
        try:
            if request("/api/health", cookie="")[0] == 200:
                break
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(0.2)
    else:
        raise RuntimeError("Fixture server did not become healthy")

    results_route = f"/api/evaluation-tasks/{task_id}/results"
    review_route = f"/api/evaluation-results/{result_id}/reviews"
    before = data(results_route)
    original = data(review_route)
    assert request(review_route, cookie="")[0] == 401
    assert request(review_route, cookie="eval_agent_session=" + token(other_id, "http-fixture-other"))[0] == 404
    assert request(f"/api/evaluation-results/{result_id}/evidence?key=../../.env")[0] == 404

    image_count = 0
    for row in before["rows"]:
        detail = data(f"/api/evaluation-results/{row['id']}/reviews")
        for image in detail["images"]:
            status, content, headers = request(image["url"])
            assert status == 200, (row["rowIndex"], image["key"], status)
            assert headers["Content-Type"].startswith("image/") and len(content) > 0
            assert headers["Cache-Control"] == "private, no-store"
            image_count += 1
    report["readable_images"] = image_count

    body = {"submissionKey": str(uuid.uuid4()), "expectedVersion": original["reviewVersion"], "verdict": "incorrect", "reason": "功能测试：仅在独立测试数据库验证修正保存，不作为人工验收。", "correctedScore": 100, "correctedPassed": True}
    assert request(review_route, body, origin="http://untrusted.invalid")[0] == 403
    first_status, first_raw, _ = request(review_route, body)
    assert first_status == 200, (first_status, json.loads(first_raw).get("message"))
    first = json.loads(first_raw)["data"]
    retry_status, retry_raw, _ = request(review_route, body)
    assert retry_status == 200 and json.loads(retry_raw)["data"]["id"] == first["id"]
    assert request(review_route, {**body, "submissionKey": str(uuid.uuid4())})[0] == 409
    assert request(review_route, {**body, "submissionKey": str(uuid.uuid4()), "expectedVersion": first["revision"], "correctedScore": 101})[0] == 400
    assert data(results_route + "?review=incorrect")["total"] == 1
    csv_status, csv_bytes, _ = request(f"/api/evaluation-tasks/{task_id}/export?format=csv")
    assert csv_status == 200
    exported = list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig"))))
    assert exported[0]["manualVerdict"] == "判错了" and exported[0]["manualScore"] == "100"
    second = {**body, "submissionKey": str(uuid.uuid4()), "expectedVersion": first["revision"], "verdict": "uncertain", "reason": "功能测试：验证改判后的历史保留。", "correctedScore": None, "correctedPassed": None}
    assert request(review_route, second)[0] == 200
    after = data(review_route)
    assert len(after["reviews"]) == 2 and [row["verdict"] for row in after["reviews"]] == ["uncertain", "incorrect"]
    assert (after["score"], after["passed"], after["reason"]) == (original["score"], original["passed"], original["reason"])
    assert data(results_route + "?review=incorrect")["total"] == 0
    assert data(results_route + "?review=uncertain")["total"] == 1
    stats = data(results_route)
    assert (stats["avgScore"], stats["passRate"]) == (before["avgScore"], before["passRate"])

    status, xlsx, _ = request(f"/api/evaluation-tasks/{task_id}/export?format=xlsx")
    assert status == 200
    from openpyxl import load_workbook
    workbook = load_workbook(io.BytesIO(xlsx), read_only=True)
    values = list(workbook.active.values)
    headers = list(values[0])
    assert values[1][headers.index("manualVerdict")] == "暂时无法判断"
    history = json.loads(values[1][headers.index("reviewHistory")])
    assert len(history) == 2
    workbook.close()
    report.update({"auth_and_ownership": "passed", "invalid_key_and_origin": "passed", "save_retry_version_validation": "passed", "history_and_latest_filter": "passed", "original_ai_stats_preserved": "passed", "csv_and_xlsx": "passed", "fixture_database": str(fixture)})
    with sqlite3.connect(fixture) as db:
        assert db.execute('SELECT score,passed,reason,rawResponse FROM EvaluationResult WHERE id=?', (result_id,)).fetchone() == baseline
    with sqlite3.connect((ROOT / "prisma/dev.db").as_uri() + "?mode=ro", uri=True) as db:
        report["production_human_reviews"] = db.execute('SELECT COUNT(*) FROM EvaluationReview').fetchone()[0]
    (RUN / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
finally:
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    stdout.close()
    stderr.close()
