"""Optional isolated production-container check. Run after docker build -t les-18-bornes:local ."""
import json
import subprocess
import time
import urllib.request
import uuid


def docker(*args):
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True).stdout.strip()


suffix = uuid.uuid4().hex[:10]
name = "bornes-smoke-" + suffix
volume = "bornes-data-" + suffix
origin = "https://bornes.example.test"
fixture = {"username": "DockerTest", "password": "mot-de-passe-fixture-docker"}


def wait_ready():
    # Docker may allocate a new host port on restart when the port is dynamic.
    address = docker("port", name, "3000/tcp")
    base = "http://" + address
    for attempt in range(50):
        try:
            with urllib.request.urlopen(base + "/api/state", timeout=2) as response:
                state = json.load(response)
            return base, state
        except Exception:
            if attempt == 49:
                raise
            time.sleep(0.2)


def post(base, path):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(fixture).encode(),
        headers={"Content-Type": "application/json", "Origin": origin},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=5)


docker("volume", "create", volume)
try:
    docker("run", "--detach", "--rm", "--name", name,
           "--mount", "source=" + volume + ",target=/app/.data",
           "-p", "127.0.0.1::3000", "-e", "APP_ORIGIN=" + origin,
           "les-18-bornes:local")
    base, state = wait_ready()
    assert state["settings"]["starts_at"] == "2026-10-25T08:00:00.000Z"
    assert docker("exec", name, "id", "-u") != "0"
    with post(base, "/api/register") as response:
        assert response.status == 201
        assert "Secure" in response.headers["Set-Cookie"]
        assert response.headers["Strict-Transport-Security"] == "max-age=31536000"
    docker("restart", name)
    base, _ = wait_ready()
    with post(base, "/api/login") as response:
        assert response.status == 200, "Le compte doit survivre au redémarrage"
    docker("exec", name, "node", "-e",
           "fetch('http://127.0.0.1:3000/api/state').then(r=>process.exit(r.ok?0:1))")
    print("Docker production : image, utilisateur non-root, volume, API, cookies Secure, HSTS, redémarrage et sonde validés.")
finally:
    subprocess.run(["docker", "stop", name], capture_output=True)
    subprocess.run(["docker", "volume", "rm", volume], capture_output=True)
